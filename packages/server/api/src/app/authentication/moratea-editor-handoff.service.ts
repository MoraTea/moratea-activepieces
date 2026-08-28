import { randomBytes } from 'crypto'
import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import { cryptoUtils } from '@activepieces/server-utils'
import { AuthenticationResponse, UserStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { IsNull, LessThan } from 'typeorm'
import { z } from 'zod'
import { repoFactory } from '../core/db/repo-factory'
import { transaction } from '../core/db/transaction'
import { flowRepo } from '../flows/flow/flow.repo'
import { JwtSignAlgorithm, jwtUtils } from '../helper/jwt-utils'
import { system } from '../helper/system/system'
import { AppSystemProp } from '../helper/system/system-props'
import { platformRepo } from '../platform/platform.service'
import { projectRepo, projectService } from '../project/project-service'
import { userService } from '../user/user-service'
import { authenticationUtils } from './authentication-utils'
import { MorateaEditorHandoffEntity } from './moratea-editor-handoff.entity'
import { userIdentityService } from './user-identity/user-identity-service'

const HANDOFF_ISSUER = 'moratea'
const HANDOFF_AUDIENCE = 'activepieces-editor'
const MAX_TICKET_TTL_SECONDS = 60
const CLOCK_SKEW_SECONDS = 5
const MAX_CLAIM_LENGTH = 255
const MAX_EMAIL_LENGTH = 320
const BOOTSTRAP_TOKEN_BYTES = 32
const handoffRepo = repoFactory(MorateaEditorHandoffEntity)

export class MorateaEditorHandoffError extends ActivepiecesError {
    constructor() {
        super({
            code: ErrorCode.AUTHENTICATION,
            params: { message: 'Invalid editor handoff' },
        })
    }
}

const TicketClaimsSchema = z.object({
    iss: z.literal(HANDOFF_ISSUER),
    aud: z.literal(HANDOFF_AUDIENCE),
    iat: z.number().int(),
    exp: z.number().int(),
    jti: z.string(),
    account_id: z.string(),
    email: z.string(),
    activepieces_flow_id: z.string(),
}).strict()

type TicketClaims = z.infer<typeof TicketClaimsSchema>

type HandoffResult = {
    session: AuthenticationResponse
    editorPath: string
}

export const morateaEditorHandoffService = (log: FastifyBaseLogger): {
    accept(ticket: string): Promise<{ bootstrapToken: string }>
    redeem(bootstrapToken: string): Promise<HandoffResult>
} => ({
    async accept(ticket: string): Promise<{ bootstrapToken: string }> {
        try {
            const claims = await verifyTicket(ticket)
            const now = new Date()
            const flow = await flowRepo().findOneBy({ id: claims.activepieces_flow_id })
            if (isNil(flow)) {
                throw new MorateaEditorHandoffError()
            }
            const project = await projectRepo().findOneBy({ id: flow.projectId })
            if (isNil(project) || isNil(project.platformId)) {
                throw new MorateaEditorHandoffError()
            }
            const platform = await platformRepo().findOneBy({ id: project.platformId })
            if (isNil(platform)) {
                throw new MorateaEditorHandoffError()
            }
            const identity = await userIdentityService(log).getIdentityByEmail(claims.email)
            if (isNil(identity) || !identity.verified || identity.email !== claims.email) {
                throw new MorateaEditorHandoffError()
            }
            const user = await userService(log).getOneByIdentityAndPlatform({
                identityId: identity.id,
                platformId: project.platformId,
            })
            if (isNil(user) || user.status !== UserStatus.ACTIVE) {
                throw new MorateaEditorHandoffError()
            }
            const projects = await projectService(log).getAllForUser({
                platformId: project.platformId,
                userId: user.id,
                isPrivileged: userService(log).isUserPrivileged(user),
            })
            if (!projects.some(({ id }) => id === project.id)) {
                throw new MorateaEditorHandoffError()
            }

            const bootstrapToken = randomBytes(BOOTSTRAP_TOKEN_BYTES).toString('hex')
            const bootstrapTokenHash = cryptoUtils.hashSHA256(bootstrapToken)
            await transaction(async (entityManager) => {
                await handoffRepo(entityManager).delete({ expiresAt: LessThan(now) })
                await handoffRepo(entityManager).insert({
                    id: apId(),
                    ticketId: claims.jti,
                    bootstrapTokenHash,
                    userId: user.id,
                    platformId: project.platformId,
                    projectId: project.id,
                    flowId: flow.id,
                    expiresAt: new Date(claims.exp * 1000),
                    redeemedAt: null,
                })
            })
            return { bootstrapToken }
        }
        catch (error) {
            if (error instanceof MorateaEditorHandoffError) {
                throw error
            }
            throw new MorateaEditorHandoffError()
        }
    },

    async redeem(bootstrapToken: string): Promise<HandoffResult> {
        try {
            if (!isOpaqueToken(bootstrapToken)) {
                throw new MorateaEditorHandoffError()
            }
            const bootstrapTokenHash = cryptoUtils.hashSHA256(bootstrapToken)
            const redeemed = await transaction(async (entityManager) => {
                const row = await handoffRepo(entityManager).findOne({
                    where: {
                        bootstrapTokenHash,
                        redeemedAt: IsNull(),
                    },
                    lock: { mode: 'pessimistic_write' },
                })
                const now = new Date()
                if (isNil(row) || row.expiresAt.getTime() <= now.getTime()) {
                    throw new MorateaEditorHandoffError()
                }
                const flow = await flowRepo(entityManager).findOneBy({
                    id: row.flowId,
                    projectId: row.projectId,
                })
                const project = await projectRepo(entityManager).findOneBy({
                    id: row.projectId,
                    platformId: row.platformId,
                })
                const platform = await platformRepo(entityManager).findOneBy({ id: row.platformId })
                if (isNil(flow) || isNil(project) || isNil(platform)) {
                    throw new MorateaEditorHandoffError()
                }
                row.redeemedAt = now
                await handoffRepo(entityManager).save(row)
                return {
                    userId: row.userId,
                    platformId: row.platformId,
                    projectId: row.projectId,
                    flowId: row.flowId,
                }
            })
            const user = await userService(log).get({ id: redeemed.userId })
            if (isNil(user) || user.status !== UserStatus.ACTIVE || user.platformId !== redeemed.platformId) {
                throw new MorateaEditorHandoffError()
            }
            const session = await authenticationUtils(log).getProjectAndToken({
                userId: redeemed.userId,
                platformId: redeemed.platformId,
                projectId: redeemed.projectId,
            })
            return {
                session,
                editorPath: `/flows/${encodeURIComponent(redeemed.flowId)}?surface=moratea`,
            }
        }
        catch (error) {
            if (error instanceof MorateaEditorHandoffError) {
                throw error
            }
            throw new MorateaEditorHandoffError()
        }
    },
})

async function verifyTicket(ticket: string): Promise<TicketClaims> {
    if (typeof ticket !== 'string' || ticket.length > 4096 || ticket.split('.').length !== 3 || ticket.split('.').some((part) => part.length === 0)) {
        throw new MorateaEditorHandoffError()
    }
    const secret = system.get(AppSystemProp.MORATEA_EDITOR_HANDOFF_SECRET)
    if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
        throw new MorateaEditorHandoffError()
    }
    const decoded = await jwtUtils.decodeAndVerify<Record<string, unknown>>({
        jwt: ticket,
        key: secret,
        algorithm: JwtSignAlgorithm.HS256,
        issuer: HANDOFF_ISSUER,
        audience: HANDOFF_AUDIENCE,
    })
    const parsedClaims = TicketClaimsSchema.safeParse(decoded)
    if (!parsedClaims.success) {
        throw new MorateaEditorHandoffError()
    }
    const claims = parsedClaims.data
    const now = Math.floor(Date.now() / 1000)
    if (
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > MAX_TICKET_TTL_SECONDS ||
        claims.iat > now + CLOCK_SKEW_SECONDS ||
        claims.exp <= now ||
        claims.exp > now + MAX_TICKET_TTL_SECONDS ||
        !isBoundedClaim(claims.jti) || !isBoundedClaim(claims.account_id) ||
        !isEmail(claims.email) || !isBoundedClaim(claims.activepieces_flow_id)
    ) {
        throw new MorateaEditorHandoffError()
    }
    return claims
}

function isBoundedClaim(value: string): boolean {
    return value.length > 0 && value.length <= MAX_CLAIM_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
}

function isEmail(value: string): boolean {
    return value.length > 0 && value.length <= MAX_EMAIL_LENGTH && value === value.trim().toLowerCase() && /^[^\s@]+@[^\s@]+$/.test(value)
}

function isOpaqueToken(value: string): boolean {
    return /^[0-9a-f]{64}$/.test(value)
}
