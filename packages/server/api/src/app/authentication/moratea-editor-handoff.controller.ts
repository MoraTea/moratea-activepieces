import { FastifyReply } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { authnRateLimit } from '../core/security/rate-limit'
import { morateaEditorHandoffService } from './moratea-editor-handoff.service'

const COOKIE_NAME = '__Secure-ap_moratea_handoff'
const REDEEM_PATH = '/api/v1/authentication/moratea-editor-handoff/redeem'
const HANDOFF_ENTRY_PATH = '/moratea-editor-handoff'
const BOOTSTRAP_TTL_SECONDS = 60
const GENERIC_ERROR = { error: 'Unauthorized' }

const AcceptBody = z.object({
    ticket: z.string().min(1),
}).strict()

export const morateaEditorHandoffController: FastifyPluginAsyncZod = async (app) => {
    app.setErrorHandler((_error, request, reply) => {
        const response = noStore(reply)
        const route = request.routeOptions.url ?? request.url
        if (route.split('?', 1)[0].endsWith('/redeem')) {
            return unauthorized(response)
        }
        return redirectToHandoff(response, true)
    })

    app.post('/moratea-editor-handoff', {
        config: {
            security: securityAccess.public(),
            rateLimit: authnRateLimit,
        },
    }, async (request, reply) => {
        const response = noStore(reply)
        const body = AcceptBody.safeParse(request.body)
        if (!body.success) {
            return redirectToHandoff(response, true)
        }

        try {
            const { bootstrapToken } = await morateaEditorHandoffService(request.log).accept(body.data.ticket)
            if (!isSafeCookieValue(bootstrapToken)) {
                return await redirectToHandoff(response, true)
            }
            return await redirectToHandoff(response, false, bootstrapToken)
        }
        catch {
            return redirectToHandoff(response, true)
        }
    })

    app.post('/moratea-editor-handoff/redeem', {
        config: {
            security: securityAccess.public(),
            rateLimit: authnRateLimit,
        },
    }, async (request, reply) => {
        const response = noStore(reply)
        const cookie = parseBootstrapCookie(request.headers.cookie)
        if (request.body !== undefined && request.body !== null) {
            return unauthorized(response)
        }
        try {
            if (cookie === undefined) {
                return await unauthorized(response)
            }
            const result = await morateaEditorHandoffService(request.log).redeem(cookie)
            return await response.code(StatusCodes.OK).header('Set-Cookie', clearBootstrapCookie()).send(result)
        }
        catch {
            return unauthorized(response)
        }
    })
}

function noStore(reply: FastifyReply): FastifyReply {
    return reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .header('Referrer-Policy', 'no-referrer')
}

function redirectToHandoff(reply: FastifyReply, clearCookie: boolean, bootstrapToken?: string): FastifyReply {
    if (clearCookie) {
        return reply
            .code(StatusCodes.SEE_OTHER)
            .header('Location', HANDOFF_ENTRY_PATH)
            .header('Set-Cookie', clearBootstrapCookie())
            .send()
    }
    if (bootstrapToken === undefined) {
        return unauthorized(reply)
    }
    return reply
        .code(StatusCodes.SEE_OTHER)
        .header('Location', HANDOFF_ENTRY_PATH)
        .header('Set-Cookie', setBootstrapCookie(bootstrapToken))
        .send()
}

function unauthorized(reply: FastifyReply): FastifyReply {
    return reply
        .code(StatusCodes.UNAUTHORIZED)
        .header('Set-Cookie', clearBootstrapCookie())
        .send(GENERIC_ERROR)
}

function setBootstrapCookie(value: string): string {
    return `${COOKIE_NAME}=${value}; Path=${REDEEM_PATH}; Max-Age=${BOOTSTRAP_TTL_SECONDS}; Secure; HttpOnly; SameSite=Lax`
}

function clearBootstrapCookie(): string {
    return `${COOKIE_NAME}=; Path=${REDEEM_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`
}

function parseBootstrapCookie(header: string | undefined): string | undefined {
    if (header === undefined) return undefined

    let value: string | undefined
    for (const part of header.split(';')) {
        const item = part.trim()
        const separator = item.indexOf('=')
        if (separator <= 0) continue
        const name = item.slice(0, separator)
        if (name !== COOKIE_NAME) continue
        if (value !== undefined) return undefined
        const candidate = item.slice(separator + 1)
        if (!isSafeCookieValue(candidate)) return undefined
        value = candidate
    }
    return value
}

function isSafeCookieValue(value: string): boolean {
    return value.length > 0 && /^[\x21-\x7e]+$/.test(value) && !value.includes(';') && !value.includes(',')
}
