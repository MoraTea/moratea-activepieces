import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import jsonwebtoken from 'jsonwebtoken'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { JwtSignAlgorithm, jwtUtils } from '../../../../src/app/helper/jwt-utils'
import { db } from '../../../helpers/db'
import { createMockFlow } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const ACCEPT_URL = '/api/v1/authentication/moratea-editor-handoff'
const REDEEM_URL = `${ACCEPT_URL}/redeem`
const COOKIE_NAME = '__Secure-ap_moratea_handoff'
const REDEEM_PATH = REDEEM_URL
const HANDOFF_ENTRY_PATH = '/moratea-editor-handoff'
const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const RUST_TICKET_VECTOR = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJtb3JhdGVhIiwiYXVkIjoiYWN0aXZlcGllY2VzLWVkaXRvciIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAwMDYwLCJqdGkiOiJqdGktZml4ZWQiLCJhY2NvdW50X2lkIjoiYWNjdC0xIiwiZW1haWwiOiJhbGljZUBleGFtcGxlLmNvbSIsImFjdGl2ZXBpZWNlc19mbG93X2lkIjoiZmxvdy0xIn0.fh1K4l8Ze3D1xkisd095kVL6svnt0Chd_B-edWEfJKs'

const previousSecret = process.env.AP_MORATEA_EDITOR_HANDOFF_SECRET
process.env.AP_MORATEA_EDITOR_HANDOFF_SECRET = TEST_SECRET

let app: FastifyInstance | null = null
const getApp = (): FastifyInstance => {
    if (app === null) {
        throw new Error('Test app is not initialized')
    }
    return app
}

let ticketSequence = 0

const cookieHeader = (response: { headers: Record<string, string | string[] | undefined> } | undefined): string => {
    const value = response?.headers['set-cookie']
    return Array.isArray(value) ? value.join(';') : value ?? ''
}

const clearCookie = `${COOKIE_NAME}=; Path=${REDEEM_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`

beforeEach(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await setupTestEnvironment()
    await teardownTestEnvironment()
    if (previousSecret === undefined) {
        delete process.env.AP_MORATEA_EDITOR_HANDOFF_SECRET
    }
    else {
        process.env.AP_MORATEA_EDITOR_HANDOFF_SECRET = previousSecret
    }
})

describe('MoraTea editor handoff', () => {
    it('verifies the Rust ASCII-key ticket vector with Activepieces jsonwebtoken', () => {
        expect(jsonwebtoken.verify(RUST_TICKET_VECTOR, TEST_SECRET, {
            algorithms: ['HS256'],
            issuer: 'moratea',
            audience: 'activepieces-editor',
            ignoreExpiration: true,
        })).toMatchObject({
            jti: 'jti-fixed',
            account_id: 'acct-1',
            email: 'alice@example.com',
            activepieces_flow_id: 'flow-1',
        })
    })

    it('redirects missing tickets generically and expires the bootstrap cookie', async () => {
        const response = await app?.inject({
            method: 'POST',
            url: ACCEPT_URL,
            payload: {},
        })

        expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
        expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
        expect(response?.headers['cache-control']).toBe('no-store')
        expect(response?.headers['referrer-policy']).toBe('no-referrer')
        expect(cookieHeader(response)).toBe(clearCookie)
    })

    it('uses the same generic redirect for invalid tickets', async () => {
        const ticket = 'ticket-value-that-must-not-escape'
        const response = await app?.inject({
            method: 'POST',
            url: ACCEPT_URL,
            payload: { ticket },
        })

        expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
        expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
        expect(response?.headers.location).not.toContain(ticket)
        expect(response?.body).not.toContain(ticket)
        expect(cookieHeader(response)).toBe(clearCookie)
    })

    it('rejects unknown ticket fields without accepting them', async () => {
        const ticket = 'unknown-field-secret'
        const response = await app?.inject({
            method: 'POST',
            url: ACCEPT_URL,
            payload: { ticket: 'invalid', extra: ticket },
        })

        expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
        expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
        expect(response?.body).not.toContain(ticket)
        expect(cookieHeader(response)).toBe(clearCookie)
    })

    it('maps malformed JSON and form bodies on accept to a generic redirect', async () => {
        for (const testCase of [
            { contentType: 'application/json', payload: '{"ticket":' },
            { contentType: 'application/x-www-form-urlencoded', payload: 'ticket=%E0%A4%A' },
        ]) {
            const response = await app?.inject({
                method: 'POST',
                url: ACCEPT_URL,
                headers: { 'content-type': testCase.contentType },
                payload: testCase.payload,
            })

            expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
            expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
            expect(response?.headers['cache-control']).toBe('no-store')
            expect(response?.headers['referrer-policy']).toBe('no-referrer')
            expect(response?.body).not.toContain(testCase.payload)
            expect(response?.body).not.toContain('FST_ERR_CTP')
            expect(cookieHeader(response)).toBe(clearCookie)
        }
    })


    it('accepts and redeems a real ticket with an exact session and editor path', async () => {
        const ctx = await createTestContext(getApp())
        const flow = createMockFlow({ id: 'flow-handoff-success', projectId: ctx.project.id })
        await db.save('flow', flow)
        const ticket = await signTicket(ctx, flow.id)

        const accepted = await app?.inject({
            method: 'POST',
            url: ACCEPT_URL,
            payload: { ticket },
        })
        const acceptedCookie = cookieHeader(accepted)

        expect(accepted?.statusCode).toBe(StatusCodes.SEE_OTHER)
        expect(accepted?.headers.location).toBe(HANDOFF_ENTRY_PATH)
        expect(accepted?.headers.location).not.toContain(ticket)
        expect(accepted?.body).not.toContain(ticket)
        expect(acceptedCookie).toMatch(new RegExp(`^${COOKIE_NAME}=[0-9a-f]{64}; Path=${REDEEM_PATH}; Max-Age=60; Secure; HttpOnly; SameSite=Lax$`))

        const redeemed = await app?.inject({
            method: 'POST',
            url: REDEEM_URL,
            headers: { cookie: acceptedCookie.split(';', 1)[0] },
        })

        expect(redeemed?.statusCode).toBe(StatusCodes.OK)
        expect(redeemed?.headers['cache-control']).toBe('no-store')
        expect(redeemed?.headers['referrer-policy']).toBe('no-referrer')
        expect(cookieHeader(redeemed)).toBe(clearCookie)
        expect(redeemed?.body).not.toContain(ticket)
        expect(redeemed?.headers.location ?? '').not.toContain(ticket)
        expect(redeemed?.json()).toEqual({
            session: {
                id: ctx.user.id,
                created: ctx.user.created.toISOString(),
                updated: ctx.user.updated.toISOString(),
                platformRole: ctx.user.platformRole,
                status: ctx.user.status,
                identityId: ctx.user.identityId,
                externalId: null,
                platformId: ctx.user.platformId,
                lastActiveDate: null,
                verified: ctx.userIdentity.verified,
                firstName: ctx.userIdentity.firstName,
                lastName: ctx.userIdentity.lastName,
                email: ctx.userIdentity.email,
                trackEvents: ctx.userIdentity.trackEvents,
                newsLetter: ctx.userIdentity.newsLetter,
                token: expect.any(String),
                projectId: ctx.project.id,
            },
            editorPath: '/flows/flow-handoff-success?surface=moratea',
        })

        const secondRedeem = await app?.inject({
            method: 'POST',
            url: REDEEM_URL,
            headers: { cookie: acceptedCookie.split(';', 1)[0] },
        })
        expect(secondRedeem?.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(secondRedeem?.json()).toEqual({ error: 'Unauthorized' })
        expect(cookieHeader(secondRedeem)).toBe(clearCookie)

        const replayedTicket = await app?.inject({
            method: 'POST',
            url: ACCEPT_URL,
            payload: { ticket },
        })
        expect(replayedTicket?.statusCode).toBe(StatusCodes.SEE_OTHER)
        expect(replayedTicket?.headers.location).toBe(HANDOFF_ENTRY_PATH)
        expect(replayedTicket?.headers.location).not.toContain(ticket)
        expect(replayedTicket?.body).not.toContain(ticket)
        expect(cookieHeader(replayedTicket)).toBe(clearCookie)
    })

    it('rejects expired and overlong tickets generically', async () => {
        const ctx = await createTestContext(getApp())
        const flow = createMockFlow({ id: 'flow-handoff-ttl', projectId: ctx.project.id })
        await db.save('flow', flow)

        for (const ttlSeconds of [-1, 120]) {
            const ticket = await signTicket(ctx, flow.id, { ttlSeconds })
            const response = await app?.inject({
                method: 'POST',
                url: ACCEPT_URL,
                payload: { ticket },
            })

            expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
            expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
            expect(response?.headers.location).not.toContain(ticket)
            expect(response?.body).not.toContain(ticket)
            expect(cookieHeader(response)).toBe(clearCookie)
        }
    })
    it('rejects tickets with wrong flow, project, and user bindings', async () => {
        const ctx = await createTestContext(getApp())
        const flow = createMockFlow({ id: 'flow-handoff-bound', projectId: ctx.project.id })
        await db.save('flow', flow)
        const otherCtx = await createTestContext(getApp())
        const otherFlow = createMockFlow({ id: 'flow-handoff-other', projectId: otherCtx.project.id })
        await db.save('flow', otherFlow)

        const tickets = [
            await signTicket(ctx, 'flow-handoff-missing'),
            await signTicket(ctx, otherFlow.id),
            await signTicket(ctx, flow.id, { email: otherCtx.userIdentity.email }),
        ]

        for (const ticket of tickets) {
            const response = await app?.inject({
                method: 'POST',
                url: ACCEPT_URL,
                payload: { ticket },
            })

            expect(response?.statusCode).toBe(StatusCodes.SEE_OTHER)
            expect(response?.headers.location).toBe(HANDOFF_ENTRY_PATH)
            expect(response?.headers.location).not.toContain(ticket)
            expect(response?.body).not.toContain(ticket)
            expect(cookieHeader(response)).toBe(clearCookie)
        }
    })

    it('maps malformed JSON and form bodies on redeem to generic unauthorized', async () => {
        for (const testCase of [
            { contentType: 'application/json', payload: '{"token":' },
            { contentType: 'application/x-www-form-urlencoded', payload: 'token=%E0%A4%A' },
        ]) {
            const response = await app?.inject({
                method: 'POST',
                url: REDEEM_URL,
                headers: {
                    'content-type': testCase.contentType,
                    cookie: `${COOKIE_NAME}=parser-failure-secret`,
                },
                payload: testCase.payload,
            })

            expect(response?.statusCode).toBe(StatusCodes.UNAUTHORIZED)
            expect(response?.json()).toEqual({ error: 'Unauthorized' })
            expect(response?.headers['cache-control']).toBe('no-store')
            expect(response?.headers['referrer-policy']).toBe('no-referrer')
            expect(response?.body).not.toContain(testCase.payload)
            expect(response?.body).not.toContain('FST_ERR_CTP')
            expect(cookieHeader(response)).toBe(clearCookie)
        }
    })


    it('rejects redemption without the bootstrap cookie and always clears it', async () => {
        const response = await app?.inject({
            method: 'POST',
            url: REDEEM_URL,
        })

        expect(response?.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(response?.json()).toEqual({ error: 'Unauthorized' })
        expect(response?.headers['cache-control']).toBe('no-store')
        expect(response?.headers['referrer-policy']).toBe('no-referrer')
        expect(cookieHeader(response)).toBe(clearCookie)
    })

    it('rejects malformed and replay-shaped cookies without exposing the value', async () => {
        const cookie = `${COOKIE_NAME}=not-a-valid-bootstrap; ${COOKIE_NAME}=replayed`
        const response = await app?.inject({
            method: 'POST',
            url: REDEEM_URL,
            headers: { cookie },
        })

        expect(response?.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(response?.body).not.toContain(cookie)
        expect(cookieHeader(response)).toBe(clearCookie)
    })
})

async function signTicket(
    ctx: TestContext,
    flowId: string,
    options: { email?: string, ttlSeconds?: number } = {},
): Promise<string> {
    return jwtUtils.sign({
        payload: {
            jti: `handoff-ticket-${++ticketSequence}`,
            account_id: ctx.user.id,
            email: options.email ?? ctx.userIdentity.email,
            activepieces_flow_id: flowId,
        },
        key: TEST_SECRET,
        algorithm: JwtSignAlgorithm.HS256,
        issuer: 'moratea',
        audience: 'activepieces-editor',
        expiresInSeconds: options.ttlSeconds ?? 60,
    })
}
