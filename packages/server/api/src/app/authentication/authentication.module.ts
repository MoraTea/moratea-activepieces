import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { authenticationController } from './authentication.controller'
import { morateaEditorHandoffController } from './moratea-editor-handoff.controller'

export const authenticationModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(authenticationController, {
        prefix: '/v1/authentication',
    })
    await app.register(morateaEditorHandoffController, {
        prefix: '/v1/authentication',
    })
}
