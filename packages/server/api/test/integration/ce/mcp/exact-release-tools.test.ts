import { apId } from '@activepieces/core-utils'
import { FlowOperationStatus, FlowOperationType, FlowRunStatus, FlowStatus, FlowTriggerType, FlowVersionState, McpServerType, PackageType, PieceType, RunEnvironment, TriggerStrategy, TriggerTestStrategy } from '@activepieces/shared'
import type { FlowRun, ProjectScopedMcpServer } from '@activepieces/shared'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import * as flowSideEffectsModule from '../../../../src/app/flows/flow/flow-service-side-effects'
import { flowService } from '../../../../src/app/flows/flow/flow.service'
import * as exactFlowVersionServiceModule from '../../../../src/app/flows/flow-version/exact-flow-version.service'
import * as flowVersionMutationLockModule from '../../../../src/app/flows/flow-version/flow-version-mutation-lock'
import * as flowVersionValidatorModule from '../../../../src/app/flows/flow-version/flow-version-validator-util'
import { flowVersionService } from '../../../../src/app/flows/flow-version/flow-version.service'
import { activepiecesTools } from '../../../../src/app/mcp/tools'
import { apActivateFlowVersionTool, apFreezeFlowVersionTool, apGetFlowVersionTool, apRestoreFlowVersionAsDraftTool, apTestFlowVersionTool } from '../../../../src/app/mcp/tools/ap-release-tools'
import * as flowRunUtilsModule from '../../../../src/app/mcp/tools/flow-run-utils'
import * as triggerSourceModule from '../../../../src/app/trigger/trigger-source/trigger-source-service'
import { db } from '../../../helpers/db'
import { createMockFlow, createMockFlowVersion, createMockPieceMetadata } from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
let log: FastifyBaseLogger

beforeAll(async () => {
    app = await setupTestEnvironment()
    log = app.log
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function makeMcp(projectId: string): ProjectScopedMcpServer {
    return {
        id: apId(),
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        projectId,
        platformId: null,
        type: McpServerType.PROJECT,
        token: apId(),
        disabledTools: null,
    }
}

describe('Exact release MCP tools', () => {
    it('freezes one exact draft without changing production', async () => {
        const ctx = await createTestContext(app)
        const published = createMockFlowVersion({ state: FlowVersionState.LOCKED, valid: true })
        const flow = createMockFlow({
            projectId: ctx.project.id,
            status: FlowStatus.ENABLED,
        })
        published.flowId = flow.id
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            trigger: { ...published.trigger, valid: true },
            created: new Date(Date.now() + 1_000).toISOString(),
        })
        await db.save('flow', flow)
        await db.save('flow_version', [published, draft])
        await db.update('flow', flow.id, { publishedVersionId: published.id })

        const result = await apFreezeFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: draft.id,
        })

        expect(result.structuredContent, JSON.stringify(result)).toBeDefined()
        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: draft.id,
            state: FlowVersionState.LOCKED,
        })
        const frozen = await db.findOneByOrFail('flow_version', { id: draft.id })
        const unchangedFlow = await db.findOneByOrFail('flow', { id: flow.id })
        expect(frozen.state).toBe(FlowVersionState.LOCKED)
        expect(unchangedFlow.status).toBe(FlowStatus.ENABLED)
        expect(unchangedFlow.publishedVersionId).toBe(published.id)
    })

    it('rejects freezing a valid draft with an unsupported schema version', async () => {
        const ctx = await createTestContext(app)
        const published = createMockFlowVersion({ state: FlowVersionState.LOCKED, valid: true })
        const flow = createMockFlow({
            projectId: ctx.project.id,
            status: FlowStatus.ENABLED,
            publishedVersionId: null,
        })
        published.flowId = flow.id
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            schemaVersion: '999',
            trigger: { ...published.trigger, valid: true },
            created: new Date(Date.now() + 1_000).toISOString(),
        })
        await db.save('flow', flow)
        await db.save('flow_version', [published, draft])
        await db.update('flow', flow.id, { publishedVersionId: published.id })

        const result = await apFreezeFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: draft.id,
        })

        expect(result.isError).toBe(true)
        const unchangedDraft = await db.findOneByOrFail('flow_version', { id: draft.id })
        const unchangedFlow = await db.findOneByOrFail('flow', { id: flow.id })
        expect(unchangedDraft.state).toBe(FlowVersionState.DRAFT)
        expect(unchangedDraft.schemaVersion).toBe('999')
        expect(unchangedFlow.status).toBe(FlowStatus.ENABLED)
        expect(unchangedFlow.publishedVersionId).toBe(published.id)
    })

    it('rejects a stale author mutation after the exact draft is frozen', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const staleDraft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', staleDraft)
        await apFreezeFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: staleDraft.id,
        })

        await expect(flowVersionService(log).applyOperation({
            projectId: ctx.project.id,
            platformId: ctx.project.platformId,
            userId: ctx.user.id,
            flowVersion: staleDraft,
            userOperation: {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'stale edit' },
            },
        })).rejects.toThrow()

        const frozen = await db.findOneByOrFail('flow_version', { id: staleDraft.id })
        expect(frozen.state).toBe(FlowVersionState.LOCKED)
        expect(frozen.displayName).toBe(staleDraft.displayName)
    })

    it('reads the exact requested version when a newer draft exists', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const locked = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            displayName: 'approved release',
        })
        const newerDraft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            displayName: 'conflicting draft',
            created: new Date(Date.now() + 1_000).toISOString(),
        })
        await db.save('flow', flow)
        await db.save('flow_version', [locked, newerDraft])

        const result = await apGetFlowVersionTool(makeMcp(ctx.project.id), log).execute({
            flowId: flow.id,
            flowVersionId: locked.id,
        })

        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: locked.id,
            displayName: 'approved release',
            state: FlowVersionState.LOCKED,
        })
    })

    it('queues a test run for the exact locked version and returns its identity', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const locked = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        const newerDraft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            created: new Date(Date.now() + 1_000).toISOString(),
        })
        await db.save('flow', flow)
        await db.save('flow_version', [locked, newerDraft])

        const result = await apTestFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: locked.id,
            fixture: { invoice_number: 'INV-1007' },
            waitForCompletion: false,
        })

        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: locked.id,
            environment: RunEnvironment.TESTING,
        })
        expect(result.structuredContent?.runId).toEqual(expect.any(String))
        const run = await db.findOneByOrFail('flow_run', { id: result.structuredContent?.runId })
        expect(run.flowVersionId).toBe(locked.id)
        expect(run.environment).toBe(RunEnvironment.TESTING)
        expect(run.status).toBe(FlowRunStatus.QUEUED)
    })

    it('returns a generic MCP error when the worker is unavailable while waiting for completion', async () => {
        const flowId = apId()
        const flowVersionId = apId()
        const projectId = apId()
        const run = {
            id: apId(),
            flowId,
            flowVersionId,
            environment: RunEnvironment.TESTING,
            status: FlowRunStatus.QUEUED,
        } as unknown as FlowRun
        const test = vi.fn().mockResolvedValue(run)
        const service = vi.spyOn(exactFlowVersionServiceModule, 'exactFlowVersionService').mockReturnValue({ test } as never)
        const poll = vi.spyOn(flowRunUtilsModule, 'pollForRunCompletion').mockRejectedValue(new Error('worker unavailable'))
        try {
            const result = await apTestFlowVersionTool({ mcp: makeMcp(projectId) }, log).execute({
                flowId,
                flowVersionId,
                fixture: {},
                waitForCompletion: true,
            })

            expect(result.isError).toBe(true)
            expect(result.content[0]).toMatchObject({
                type: 'text',
                text: expect.stringContaining('Exact flow-version test failed'),
            })
            expect(poll).toHaveBeenCalledWith(log, run.id, projectId)
        }
        finally {
            poll.mockRestore()
            service.mockRestore()
        }
    })

    it('rejects activation of a draft version', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', draft)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: draft.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        const unchanged = await db.findOneByOrFail('flow', { id: flow.id })
        expect(unchanged.status).toBe(FlowStatus.DISABLED)
        expect(unchanged.publishedVersionId).toBeNull()
    })

    it('activates the exact locked version while ignoring a newer draft', async () => {
        const ctx = await createTestContext(app)
        await db.save('piece_metadata', createMockPieceMetadata({
            name: '@activepieces/piece-schedule',
            version: '0.1.5',
            packageType: PackageType.REGISTRY,
            pieceType: PieceType.OFFICIAL,
            triggers: {
                every_hour: {
                    name: 'every_hour',
                    displayName: 'Every Hour',
                    description: 'Runs every hour',
                    requireAuth: false,
                    props: {},
                    type: TriggerStrategy.POLLING,
                    sampleData: {},
                    testStrategy: TriggerTestStrategy.TEST_FUNCTION,
                },
            },
        }))
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const target = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            trigger: {
                type: FlowTriggerType.PIECE,
                name: 'trigger',
                displayName: 'Every Hour',
                valid: true,
                lastUpdatedDate: new Date().toISOString(),
                settings: {
                    pieceName: '@activepieces/piece-schedule',
                    pieceVersion: '0.1.5',
                    triggerName: 'every_hour',
                    input: {},
                    propertySettings: {},
                },
            },
        })
        const newerDraft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            created: new Date(Date.now() + 1_000).toISOString(),
        })
        await db.save('flow', flow)
        await db.save('flow_version', [target, newerDraft])

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
            expectedPublishedVersionId: null,
        })

        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: target.id,
            previousPublishedVersionId: null,
            publishedVersionId: target.id,
            status: FlowStatus.ENABLED,
        })
        const activated = await db.findOneByOrFail('flow', { id: flow.id })
        const triggerSource = await db.findOneByOrFail('trigger_source', { flowId: flow.id })
        expect(activated.publishedVersionId).toBe(target.id)
        expect(activated.status).toBe(FlowStatus.ENABLED)
        expect(triggerSource.flowVersionId).toBe(target.id)
    })

    it('reconciles activation after a lost successful response', async () => {
        const ctx = await createTestContext(app)
        await db.save('piece_metadata', createMockPieceMetadata({
            name: '@activepieces/piece-schedule',
            version: '0.1.5',
            packageType: PackageType.REGISTRY,
            pieceType: PieceType.OFFICIAL,
            triggers: {
                every_hour: {
                    name: 'every_hour',
                    displayName: 'Every Hour',
                    description: 'Runs every hour',
                    requireAuth: false,
                    props: {},
                    type: TriggerStrategy.POLLING,
                    sampleData: {},
                    testStrategy: TriggerTestStrategy.TEST_FUNCTION,
                },
            },
        }))
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const target = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            trigger: {
                type: FlowTriggerType.PIECE,
                name: 'trigger',
                displayName: 'Every Hour',
                valid: true,
                lastUpdatedDate: new Date().toISOString(),
                settings: {
                    pieceName: '@activepieces/piece-schedule',
                    pieceVersion: '0.1.5',
                    triggerName: 'every_hour',
                    input: {},
                    propertySettings: {},
                },
            },
        })
        await db.save('flow', flow)
        await db.save('flow_version', target)

        // Model a client timeout after the server committed: the receipt is lost.
        await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
            expectedPublishedVersionId: null,
        })

        const readback = await apGetFlowVersionTool(makeMcp(ctx.project.id), log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
        })
        expect(readback.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: target.id,
            currentPublishedVersionId: target.id,
            flowStatus: FlowStatus.ENABLED,
        })
        const triggerSourceBeforeRetry = await triggerSourceModule.triggerSourceService(log).getByFlowId({
            flowId: flow.id,
            projectId: ctx.project.id,
            simulate: false,
        })
        expect(triggerSourceBeforeRetry).not.toBeNull()
        const triggerSourceIdBeforeRetry = triggerSourceBeforeRetry?.id
        const triggerSourceFlowVersionIdBeforeRetry = triggerSourceBeforeRetry?.flowVersionId
        expect(triggerSourceFlowVersionIdBeforeRetry).toBe(target.id)

        const expectedPublishedVersionId = readback.structuredContent?.currentPublishedVersionId

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
            expectedPublishedVersionId,
        })
        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            flowVersionId: target.id,
            previousPublishedVersionId: target.id,
            publishedVersionId: target.id,
            status: FlowStatus.ENABLED,
        })
        const triggerSources = await databaseConnection().getRepository('trigger_source').find({
            where: {
                flowId: flow.id,
                projectId: ctx.project.id,
            },
        })
        expect(triggerSources).toHaveLength(1)
        expect(triggerSources[0]?.id).toBe(triggerSourceIdBeforeRetry)
        expect(triggerSources[0]?.flowVersionId).toBe(triggerSourceFlowVersionIdBeforeRetry)
        expect(triggerSources[0]?.flowVersionId).toBe(target.id)
    })

    it('restores a locked version as a new draft without modifying the source', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const source = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            displayName: 'known good',
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', source)

        const result = await apRestoreFlowVersionAsDraftTool({ mcp: makeMcp(ctx.project.id), userId: ctx.user.id }, log).execute({
            flowId: flow.id,
            flowVersionId: source.id,
            expectedLatestVersionId: source.id,
        })

        expect(result.structuredContent).toMatchObject({
            flowId: flow.id,
            sourceFlowVersionId: source.id,
            state: FlowVersionState.DRAFT,
        })
        expect(result.structuredContent?.flowVersionId).not.toBe(source.id)
        const unchangedSource = await db.findOneByOrFail('flow_version', { id: source.id })
        const restoredDraft = await db.findOneByOrFail('flow_version', { id: result.structuredContent?.flowVersionId })
        expect(unchangedSource.state).toBe(FlowVersionState.LOCKED)
        expect(unchangedSource.displayName).toBe('known good')
        expect(restoredDraft.state).toBe(FlowVersionState.DRAFT)
        expect(restoredDraft.displayName).toBe('known good')
    })

    it('serializes author edits with exact version freeze', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', draft)

        const {
            promise: validationEntered,
            resolve: validationEnteredResolve,
        } = Promise.withResolvers<undefined>()
        const {
            promise: validationRelease,
            resolve: releaseValidation,
        } = Promise.withResolvers<undefined>()
        const originalValidationUtil = flowVersionValidatorModule.flowVersionValidationUtil
        const validationSpy = vi.spyOn(flowVersionValidatorModule, 'flowVersionValidationUtil').mockImplementation((validatorLog) => {
            const delegate = originalValidationUtil(validatorLog)
            const originalPrepare = delegate.prepareRequest
            delegate.prepareRequest = async (...args: Parameters<typeof originalPrepare>) => {
                validationEnteredResolve(undefined)
                await validationRelease
                return originalPrepare(...args)
            }
            return delegate
        })
        const lockCalls: { flowId: string, key: string }[] = []
        const originalMutationLock = flowVersionMutationLockModule.withFlowVersionMutationLock
        const mutationLockSpy = vi.spyOn(flowVersionMutationLockModule, 'withFlowVersionMutationLock').mockImplementation((params) => {
            lockCalls.push({
                flowId: params.flowId,
                key: flowVersionMutationLockModule.flowVersionMutationLockKey(params.flowId),
            })
            return originalMutationLock(params)
        })
        try {
            const editPromise = flowService(log).update({
                id: flow.id,
                userId: ctx.user.id,
                projectId: ctx.project.id,
                platformId: ctx.project.platformId,
                operation: {
                    type: FlowOperationType.CHANGE_NAME,
                    request: { displayName: 'serialized edit' },
                },
            })
            await validationEntered

            const freezePromise = apFreezeFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
                flowId: flow.id,
                flowVersionId: draft.id,
            })
            releaseValidation(undefined)
            await Promise.all([editPromise, freezePromise])

            expect(mutationLockSpy).toHaveBeenCalledTimes(2)
            expect(lockCalls).toEqual([
                { flowId: flow.id, key: flowVersionMutationLockModule.flowVersionMutationLockKey(flow.id) },
                { flowId: flow.id, key: flowVersionMutationLockModule.flowVersionMutationLockKey(flow.id) },
            ])

            const frozen = await db.findOneByOrFail('flow_version', { id: draft.id })
            expect(frozen.state).toBe(FlowVersionState.LOCKED)
            expect(frozen.displayName).toBe('serialized edit')
        }
        finally {
            releaseValidation(undefined)
            validationSpy.mockRestore()
            mutationLockSpy.mockRestore()
        }
    })

    it('registers the trusted exact-release tool surface', async () => {
        const ctx = await createTestContext(app)
        const original = process.env.AP_EXACT_RELEASE_TOOLS_ENABLED
        try {
            delete process.env.AP_EXACT_RELEASE_TOOLS_ENABLED
            const absentWhenUnset = activepiecesTools(makeMcp(ctx.project.id), ctx.user.id, log).map((tool) => tool.title)
            expect(absentWhenUnset).not.toContain('ap_freeze_flow_version')
            expect(absentWhenUnset).not.toContain('ap_get_flow_version')
            expect(absentWhenUnset).not.toContain('ap_test_flow_version')
            expect(absentWhenUnset).not.toContain('ap_activate_flow_version')
            expect(absentWhenUnset).not.toContain('ap_restore_flow_version_as_draft')

            process.env.AP_EXACT_RELEASE_TOOLS_ENABLED = 'false'
            const absentWhenFalse = activepiecesTools(makeMcp(ctx.project.id), ctx.user.id, log).map((tool) => tool.title)
            expect(absentWhenFalse).not.toContain('ap_freeze_flow_version')
            expect(absentWhenFalse).not.toContain('ap_get_flow_version')
            expect(absentWhenFalse).not.toContain('ap_test_flow_version')
            expect(absentWhenFalse).not.toContain('ap_activate_flow_version')
            expect(absentWhenFalse).not.toContain('ap_restore_flow_version_as_draft')

            process.env.AP_EXACT_RELEASE_TOOLS_ENABLED = 'true'
            const present = activepiecesTools(makeMcp(ctx.project.id), ctx.user.id, log).map((tool) => tool.title)
            expect(present).toEqual(expect.arrayContaining([
                'ap_freeze_flow_version',
                'ap_get_flow_version',
                'ap_test_flow_version',
                'ap_activate_flow_version',
                'ap_restore_flow_version_as_draft',
            ]))
        }
        finally {
            if (original === undefined) {
                delete process.env.AP_EXACT_RELEASE_TOOLS_ENABLED
            }
            else {
                process.env.AP_EXACT_RELEASE_TOOLS_ENABLED = original
            }
        }
    })

    it('routes post-freeze author edits into a new draft', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            displayName: 'candidate',
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', draft)
        await apFreezeFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: draft.id,
        })

        const edited = await flowService(log).update({
            id: flow.id,
            userId: ctx.user.id,
            projectId: ctx.project.id,
            platformId: ctx.project.platformId,
            operation: {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'new draft' },
            },
        })

        const frozen = await db.findOneByOrFail('flow_version', { id: draft.id })
        expect(edited.version.id).not.toBe(draft.id)
        expect(edited.version.state).toBe(FlowVersionState.DRAFT)
        expect(edited.version.displayName).toBe('new draft')
        expect(frozen.state).toBe(FlowVersionState.LOCKED)
        expect(frozen.displayName).toBe('candidate')
    })

    it('rejects testing a draft version', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const draft = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.DRAFT,
            valid: true,
            trigger: { ...createMockFlowVersion().trigger, valid: true },
        })
        await db.save('flow', flow)
        await db.save('flow_version', draft)

        const result = await apTestFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: draft.id,
            fixture: {},
        })

        expect(result.isError).toBe(true)
        expect(await db.findOneBy('flow_run', { flowVersionId: draft.id })).toBeNull()
    })

    it('rejects activation of an invalid locked version', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const invalid = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: false,
        })
        await db.save('flow', flow)
        await db.save('flow_version', invalid)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: invalid.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        const unchanged = await db.findOneByOrFail('flow', { id: flow.id })
        expect(unchanged.publishedVersionId).toBeNull()
        expect(unchanged.status).toBe(FlowStatus.DISABLED)
    })

    it('rejects activation of a version owned by another flow', async () => {
        const ctx = await createTestContext(app)
        const requestedFlow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const otherFlow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const foreignVersion = createMockFlowVersion({
            flowId: otherFlow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
        })
        await db.save('flow', [requestedFlow, otherFlow])
        await db.save('flow_version', foreignVersion)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: requestedFlow.id,
            flowVersionId: foreignVersion.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        expect((await db.findOneByOrFail('flow', { id: requestedFlow.id })).publishedVersionId).toBeNull()
    })

    it('rejects activation through another project context', async () => {
        const owner = await createTestContext(app)
        const caller = await createTestContext(app)
        const flow = createMockFlow({ projectId: owner.project.id, status: FlowStatus.DISABLED })
        const version = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
        })
        await db.save('flow', flow)
        await db.save('flow_version', version)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(caller.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: version.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        expect((await db.findOneByOrFail('flow', { id: flow.id })).publishedVersionId).toBeNull()
    })

    it('rejects a stale published-version expectation', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const current = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true })
        const target = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true })
        await db.save('flow', flow)
        await db.save('flow_version', [current, target])
        await db.update('flow', flow.id, { publishedVersionId: current.id })

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        expect((await db.findOneByOrFail('flow', { id: flow.id })).publishedVersionId).toBe(current.id)
    })

    it('leaves production disabled when target trigger activation fails', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        const target = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            valid: true,
            trigger: {
                type: FlowTriggerType.PIECE,
                name: 'trigger',
                displayName: 'Missing Trigger',
                valid: true,
                lastUpdatedDate: new Date().toISOString(),
                settings: {
                    pieceName: '@activepieces/piece-does-not-exist',
                    pieceVersion: '0.0.1',
                    triggerName: 'missing',
                    input: {},
                    propertySettings: {},
                },
            },
        })
        await db.save('flow', flow)
        await db.save('flow_version', target)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: target.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        const contained = await db.findOneByOrFail('flow', { id: flow.id })
        expect(contained.status).toBe(FlowStatus.DISABLED)
        expect(contained.publishedVersionId).toBeNull()
    })

    it('rejects activation when flow is being deleted', async () => {
        const ctx = await createTestContext(app)
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED, operationStatus: FlowOperationStatus.DELETING })
        const locked = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true, trigger: { ...createMockFlowVersion().trigger, valid: true } })
        await db.save('flow', flow)
        await db.save('flow_version', locked)

        const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
            flowId: flow.id,
            flowVersionId: locked.id,
            expectedPublishedVersionId: null,
        })

        expect(result.isError).toBe(true)
        const unchanged = await db.findOneByOrFail('flow', { id: flow.id })
        expect(unchanged.publishedVersionId).toBeNull()
        expect(unchanged.status).toBe(FlowStatus.DISABLED)
        expect(unchanged.operationStatus).toBe(FlowOperationStatus.DELETING)
    })

    it('reconciles previous trigger after initial disable throws', async () => {
        const ctx = await createTestContext(app)
        await db.save('piece_metadata', createMockPieceMetadata({
            name: '@activepieces/piece-schedule',
            version: '0.1.5',
            packageType: PackageType.REGISTRY,
            pieceType: PieceType.OFFICIAL,
            triggers: {
                every_hour: {
                    name: 'every_hour',
                    displayName: 'Every Hour',
                    description: 'Runs every hour',
                    requireAuth: false,
                    props: {},
                    type: TriggerStrategy.POLLING,
                    sampleData: {},
                    testStrategy: TriggerTestStrategy.TEST_FUNCTION,
                },
            },
        }))
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.ENABLED })
        const scheduleTrigger = {
            type: FlowTriggerType.PIECE as const,
            name: 'trigger',
            displayName: 'Every Hour',
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {
                pieceName: '@activepieces/piece-schedule',
                pieceVersion: '0.1.5',
                triggerName: 'every_hour',
                input: {},
                propertySettings: {},
            },
        }
        const previous = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true, trigger: scheduleTrigger })
        const target = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true, trigger: { ...scheduleTrigger, lastUpdatedDate: new Date().toISOString() } })
        await db.save('flow', flow)
        await db.save('flow_version', [previous, target])
        await db.update('flow', flow.id, { publishedVersionId: previous.id })
        await triggerSourceModule.triggerSourceService(log).enable({
            flowVersion: previous,
            projectId: ctx.project.id,
            simulate: false,
        })

        const originalTriggerService = triggerSourceModule.triggerSourceService
        let disableCalls = 0
        const enabledVersionIds: string[] = []
        const triggerSpy = vi.spyOn(triggerSourceModule, 'triggerSourceService').mockImplementation((spyLog) => {
            const real = originalTriggerService(spyLog)
            return {
                ...real,
                disable: async (params) => {
                    disableCalls++
                    if (disableCalls === 1) {
                        await real.disable(params)
                        throw new Error('injected initial disable failure')
                    }
                    return real.disable(params)
                },
                enable: async (params) => {
                    enabledVersionIds.push(params.flowVersion.id)
                    return real.enable(params)
                },
            }
        })
        try {
            const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
                flowId: flow.id,
                flowVersionId: target.id,
                expectedPublishedVersionId: previous.id,
            })
            expect(result.isError).toBe(true)
            expect(disableCalls).toBe(1)
            expect(enabledVersionIds).toEqual([previous.id])
            const finalFlow = await db.findOneByOrFail('flow', { id: flow.id })
            expect(finalFlow.publishedVersionId).toBe(previous.id)
            expect(finalFlow.status).toBe(FlowStatus.ENABLED)
            const triggerSource = await db.findOneBy('trigger_source', { flowId: flow.id, projectId: ctx.project.id, simulate: false })
            expect(triggerSource?.flowVersionId).toBe(previous.id)
        }
        finally {
            triggerSpy.mockRestore()
        }
    })

    it('keeps original pointer disabled and does not re-enable previous when target cleanup fails', async () => {
        const ctx = await createTestContext(app)
        await db.save('piece_metadata', createMockPieceMetadata({
            name: '@activepieces/piece-schedule',
            version: '0.1.5',
            packageType: PackageType.REGISTRY,
            pieceType: PieceType.OFFICIAL,
            triggers: {
                every_hour: {
                    name: 'every_hour',
                    displayName: 'Every Hour',
                    description: 'Runs every hour',
                    requireAuth: false,
                    props: {},
                    type: TriggerStrategy.POLLING,
                    sampleData: {},
                    testStrategy: TriggerTestStrategy.TEST_FUNCTION,
                },
            },
        }))
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.ENABLED })
        const scheduleTrigger = {
            type: FlowTriggerType.PIECE as const,
            name: 'trigger',
            displayName: 'Every Hour',
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {
                pieceName: '@activepieces/piece-schedule',
                pieceVersion: '0.1.5',
                triggerName: 'every_hour',
                input: {},
                propertySettings: {},
            },
        }
        const previous = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true, trigger: scheduleTrigger })
        const target = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.LOCKED, valid: true, trigger: { ...scheduleTrigger, lastUpdatedDate: new Date().toISOString() } })
        await db.save('flow', flow)
        await db.save('flow_version', [previous, target])
        await db.update('flow', flow.id, { publishedVersionId: previous.id })
        const originalTriggerService = triggerSourceModule.triggerSourceService
        let disableCalls = 0
        const triggerSpy = vi.spyOn(triggerSourceModule, 'triggerSourceService').mockImplementation((spyLog) => {
            const real = originalTriggerService(spyLog)
            return {
                ...real,
                disable: async (params) => {
                    disableCalls++
                    if (disableCalls === 2) {
                        throw new Error('injected target cleanup failure')
                    }
                    return real.disable(params)
                },
            }
        })
        const originalSideEffects = flowSideEffectsModule.flowSideEffects
        let preUpdateCalls = 0
        const sideSpy = vi.spyOn(flowSideEffectsModule, 'flowSideEffects').mockImplementation((spyLog) => {
            const real = originalSideEffects(spyLog)
            return {
                ...real,
                preUpdateStatus: async (params) => {
                    preUpdateCalls++
                    if (preUpdateCalls === 1) {
                        throw new Error('injected target enable failure')
                    }
                    return real.preUpdateStatus(params)
                },
            }
        })
        try {
            const result = await apActivateFlowVersionTool({ mcp: makeMcp(ctx.project.id) }, log).execute({
                flowId: flow.id,
                flowVersionId: target.id,
                expectedPublishedVersionId: previous.id,
            })
            expect(result.isError).toBe(true)
            const finalFlow = await db.findOneByOrFail('flow', { id: flow.id })
            expect(finalFlow.publishedVersionId).toBe(previous.id)
            expect(finalFlow.status).toBe(FlowStatus.DISABLED)
            expect(preUpdateCalls).toBe(1)
            expect(disableCalls).toBe(2)
        }
        finally {
            triggerSpy.mockRestore()
            sideSpy.mockRestore()
        }
    })
})
