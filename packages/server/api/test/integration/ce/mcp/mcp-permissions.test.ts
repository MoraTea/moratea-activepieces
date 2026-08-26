import { Permission } from '@activepieces/core-utils'
import { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePermissionChecker } from '../../../../src/app/mcp/mcp-permissions'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
let mockLog: FastifyBaseLogger

beforeAll(async () => {
    app = await setupTestEnvironment()
    mockLog = app.log
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function text(result: { content: Array<{ type: 'text', text: string }> }): string {
    return result.content.map((c) => c.text).join('\n')
}

describe('CE MCP permissions - membership enforcement', () => {
    it('valid CE member is accepted for permissioned tools (ALLOW_ALL)', async () => {
        const ctx = await createTestContext(app)

        const checker = await resolvePermissionChecker({ userId: ctx.user.id, projectId: ctx.project.id, log: mockLog })

        // CE member gets ALLOW_ALL: permissioned tools are not denied
        const permissionedError = checker.check(Permission.WRITE_FLOW, 'ap_create_flow')
        expect(permissionedError).toBeNull()

        const readError = checker.check(Permission.READ_FLOW, 'ap_list_flows')
        expect(readError).toBeNull()

        const unpermissionedError = checker.check(undefined, 'ap_setup_guide')
        expect(unpermissionedError).toBeNull()

        // wrapExecute must not wrap when allowed
        const fakeExecute = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
        const wrapped = checker.wrapExecute({ execute: fakeExecute, permission: Permission.WRITE_FLOW, toolTitle: 'ap_create_flow' })
        expect(wrapped).toBe(fakeExecute)
    })

    it('unrelated CE user is denied for every project tool', async () => {
        const ownerCtx = await createTestContext(app)
        const unrelatedCtx = await createTestContext(app)

        const checker = await resolvePermissionChecker({ userId: unrelatedCtx.user.id, projectId: ownerCtx.project.id, log: mockLog })

        const denied = checker.check(Permission.WRITE_FLOW, 'ap_create_flow')
        expect(denied).not.toBeNull()
        expect(denied!.isError).toBe(true)
        expect(text(denied!)).toContain('Permission denied')
        expect(text(denied!)).toContain('no role found')

        // permissioned but different permission also denied
        const deniedRead = checker.check(Permission.READ_FLOW, 'ap_list_flows')
        expect(deniedRead).not.toBeNull()
        expect(deniedRead!.isError).toBe(true)

        const deniedWithoutGranularPermission = checker.check(undefined, 'ap_setup_guide')
        expect(deniedWithoutGranularPermission).not.toBeNull()
        expect(deniedWithoutGranularPermission!.isError).toBe(true)

        const fakeExecute = async () => ({ content: [{ type: 'text' as const, text: 'should not run' }] })
        const wrappedDenied = checker.wrapExecute({ execute: fakeExecute, permission: Permission.WRITE_FLOW, toolTitle: 'ap_create_flow' })
        expect(wrappedDenied).not.toBe(fakeExecute)
        const deniedResult = await wrappedDenied({})
        expect(deniedResult.isError).toBe(true)
        expect(text(deniedResult)).toContain('Permission denied')

        const wrappedWithoutGranularPermission = checker.wrapExecute({ execute: fakeExecute, permission: undefined, toolTitle: 'ap_setup_guide' })
        expect(wrappedWithoutGranularPermission).not.toBe(fakeExecute)
        expect((await wrappedWithoutGranularPermission({})).isError).toBe(true)
    })
})
