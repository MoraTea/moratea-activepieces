import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import type { FlowId, FlowVersionId, ProjectId, UserId } from '@activepieces/core-utils'
import { FlowOperationStatus, FlowOperationType, FlowStatus, flowStructureUtil, FlowVersionState, LATEST_FLOW_SCHEMA_VERSION } from '@activepieces/shared'
import type { Flow, FlowRun, FlowVersion, Step } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { IsNull } from 'typeorm'
import { transaction } from '../../core/db/transaction'
import { projectService } from '../../project/project-service'
import { triggerSourceService } from '../../trigger/trigger-source/trigger-source-service'
import { flowExecutionCache } from '../flow/flow-execution-cache'
import { flowPublishUtils } from '../flow/flow-publish-utils'
import { flowSideEffects } from '../flow/flow-service-side-effects'
import { flowRepo } from '../flow/flow.repo'
import { flowService } from '../flow/flow.service'
import { flowRunService } from '../flow-run/flow-run-service'
import { withFlowVersionMutationLock } from './flow-version-mutation-lock'
import { flowVersionRepo, flowVersionService } from './flow-version.service'

export const exactFlowVersionService = (log: FastifyBaseLogger) => ({
    async freeze(params: ExactFlowVersionParams): Promise<FlowVersion> {
        if (!params.skipVersionMutationLock) {
            return withFlowVersionMutationLock({
                log,
                flowId: params.flowId,
                fn: () => this.freeze({ ...params, skipVersionMutationLock: true }),
            })
        }
        const { projectId, flowId, flowVersionId } = params
        await flowService(log).getOneOrThrow({ id: flowId, projectId })
        const flowVersion = await flowVersionService(log).getFlowVersionOrThrow({
            flowId,
            versionId: flowVersionId,
            projectId,
        })
        assertDraftIsFreezeable(flowVersion)

        await flowVersionRepo().update({
            id: flowVersionId,
            flowId,
            state: FlowVersionState.DRAFT,
        }, {
            state: FlowVersionState.LOCKED,
        })

        return flowVersionService(log).getFlowVersionOrThrow({
            flowId,
            versionId: flowVersionId,
            projectId,
        })
    },
    async get({ projectId, flowId, flowVersionId }: ExactFlowVersionParams): Promise<FlowVersion> {
        await flowService(log).getOneOrThrow({ id: flowId, projectId })
        return flowVersionService(log).getFlowVersionOrThrow({
            flowId,
            versionId: flowVersionId,
            projectId,
        })
    },
    async test({ fixture, ...params }: TestExactFlowVersionParams): Promise<FlowRun> {
        const flowVersion = await this.get(params)
        assertLockedIsTestable(flowVersion)
        return flowRunService(log).test({
            projectId: params.projectId,
            flowVersionId: flowVersion.id,
            triggerPayload: fixture,
        })
    },
    async activate(params: ActivateExactFlowVersionParams): Promise<ActivationReceipt> {
        if (!params.skipVersionMutationLock) {
            return withFlowVersionMutationLock({
                log,
                flowId: params.flowId,
                fn: () => this.activate({ ...params, skipVersionMutationLock: true }),
            })
        }
        const { projectId, flowId, flowVersionId, expectedPublishedVersionId } = params
        const flow = await flowService(log).getOneOrThrow({ id: flowId, projectId })
        if (flow.operationStatus !== FlowOperationStatus.NONE) {
            throw new ActivepiecesError({
                code: ErrorCode.FLOW_OPERATION_IN_PROGRESS,
                params: { message: `Flow ${flowId} is already being ${flow.operationStatus}` },
            })
        }
        const targetVersion = await this.get({ projectId, flowId, flowVersionId })
        assertLockedIsTestable(targetVersion)
        if (flow.publishedVersionId !== expectedPublishedVersionId) {
            invalidOperation(`Published version changed from expected ${expectedPublishedVersionId ?? 'none'}`)
        }
        if (flow.publishedVersionId === targetVersion.id && flow.status === FlowStatus.ENABLED) {
            return activationReceipt(flow, targetVersion.id, flow.publishedVersionId)
        }

        const previousVersion = flow.publishedVersionId === null
            ? null
            : await flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: flow.publishedVersionId,
                projectId,
            })
        let previousTriggerReconciliationRequired = false
        let targetPointerInstalled = false
        try {
            if (flow.status === FlowStatus.ENABLED && previousVersion !== null) {
                previousTriggerReconciliationRequired = true
                await triggerSourceService(log).disable({
                    flowId,
                    projectId,
                    simulate: false,
                    ignoreError: false,
                })
            }

            await flowRepo().update({
                id: flowId,
                projectId,
                publishedVersionId: expectedPublishedVersionId === null ? IsNull() : expectedPublishedVersionId,
            }, {
                publishedVersionId: targetVersion.id,
                status: FlowStatus.DISABLED,
            })
            targetPointerInstalled = true
            await flowExecutionCache(log).invalidate(flowId)
            const pointedFlow = await flowService(log).getOneOrThrow({ id: flowId, projectId })
            if (pointedFlow.publishedVersionId !== targetVersion.id || pointedFlow.status !== FlowStatus.DISABLED) {
                invalidOperation('Published version changed during activation')
            }

            await flowSideEffects(log).preUpdateStatus({
                flowToUpdate: pointedFlow,
                publishedFlowVersion: targetVersion,
                newStatus: FlowStatus.ENABLED,
                templateId: pointedFlow.templateId ?? undefined,
                isRepublish: flow.status === FlowStatus.ENABLED && previousVersion !== null && flowPublishUtils.isSameTrigger({
                    published: previousVersion.trigger,
                    toPublish: targetVersion.trigger,
                }),
            })
            await flowRepo().update({
                id: flowId,
                projectId,
                publishedVersionId: targetVersion.id,
            }, {
                status: FlowStatus.ENABLED,
            })
            await flowExecutionCache(log).invalidate(flowId)
            const readback = await flowService(log).getOneOrThrow({ id: flowId, projectId })
            if (readback.publishedVersionId !== targetVersion.id || readback.status !== FlowStatus.ENABLED) {
                invalidOperation('Activated flow failed exact-version readback')
            }
            // Static import closes a flow-service/websocket/MCP cycle and crashes module loading.
            const { websocketService } = await import('../../core/websockets.service')
            websocketService.notifyWorkers().flowPublished({
                flowId,
                flowVersionId: targetVersion.id,
                projectId,
            })
            return activationReceipt(readback, targetVersion.id, flow.publishedVersionId)
        }
        catch (activationError) {
            const compensationError = await compensateActivation({
                log,
                flow,
                previousVersion,
                targetPointerInstalled,
                previousTriggerReconciliationRequired,
            })
            log.error({
                activationError,
                compensationError,
                flow: { id: flowId },
                flowVersion: { id: targetVersion.id },
            }, 'Exact flow-version activation failed')
            const message = compensationError === null
                ? 'Activation failed; previous production version restored'
                : 'Activation failed and compensation was incomplete; flow left disabled'
            invalidOperation(message)
        }
    },
    async restoreAsDraft(params: RestoreExactFlowVersionParams): Promise<FlowVersion> {
        if (!params.skipVersionMutationLock) {
            return withFlowVersionMutationLock({
                log,
                flowId: params.flowId,
                fn: () => this.restoreAsDraft({ ...params, skipVersionMutationLock: true }),
            })
        }
        const { projectId, flowId, flowVersionId, expectedLatestVersionId, userId } = params
        await flowService(log).getOneOrThrow({ id: flowId, projectId })
        const project = await projectService(log).getOneOrThrow(projectId)
        return transaction(async (entityManager) => {
            const latestVersion = await flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: undefined,
                projectId,
                entityManager,
            })
            if (latestVersion.id !== expectedLatestVersionId) {
                invalidOperation(`Latest version changed from expected ${expectedLatestVersionId}`)
            }
            const sourceVersion = await flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: flowVersionId,
                projectId,
                entityManager,
            })
            if (sourceVersion.state !== FlowVersionState.LOCKED) {
                invalidOperation(`Flow version ${sourceVersion.id} is not locked`)
            }
            let draftVersion = await flowVersionService(log).createEmptyVersion({
                flowId,
                displayName: sourceVersion.displayName,
                notes: sourceVersion.notes,
                schemaVersion: sourceVersion.schemaVersion,
                entityManager,
            })
            draftVersion = await flowVersionService(log).applyOperation({
                projectId,
                platformId: project.platformId,
                userId: userId ?? null,
                flowVersion: draftVersion,
                userOperation: {
                    type: FlowOperationType.IMPORT_FLOW,
                    request: sourceVersion,
                },
                entityManager,
            })
            return draftVersion
        })
    },
})

function assertDraftIsFreezeable(flowVersion: FlowVersion): void {
    if (flowVersion.state !== FlowVersionState.DRAFT) {
        invalidOperation(`Flow version ${flowVersion.id} is not a draft`)
    }
    if (flowVersion.schemaVersion !== LATEST_FLOW_SCHEMA_VERSION) {
        invalidOperation(`Flow version ${flowVersion.id} uses unsupported schema version ${flowVersion.schemaVersion ?? 'unknown'}`)
    }
    const invalidSteps = flowStructureUtil.getAllSteps(flowVersion.trigger)
        .filter(isInvalidRequiredStep)
    if (!flowVersion.valid || invalidSteps.length > 0) {
        invalidOperation(`Flow version ${flowVersion.id} is invalid`)
    }
}

function assertLockedIsTestable(flowVersion: FlowVersion): void {
    if (flowVersion.state !== FlowVersionState.LOCKED) {
        invalidOperation(`Flow version ${flowVersion.id} is not locked`)
    }
    const invalidSteps = flowStructureUtil.getAllSteps(flowVersion.trigger)
        .filter(isInvalidRequiredStep)
    if (!flowVersion.valid || invalidSteps.length > 0) {
        invalidOperation(`Flow version ${flowVersion.id} is invalid`)
    }
}

function isInvalidRequiredStep(step: Step): boolean {
    if (step.valid) {
        return false
    }
    return !('skip' in step) || !step.skip
}
async function compensateActivation({ log, flow, previousVersion, targetPointerInstalled, previousTriggerReconciliationRequired }: CompensateActivationParams): Promise<Error | null> {
    const errors: Error[] = []
    if (!targetPointerInstalled && !previousTriggerReconciliationRequired) {
        try {
            await flowExecutionCache(log).invalidate(flow.id)
        }
        catch (error) {
            errors.push(asError(error))
        }
        if (errors.length === 0) {
            return null
        }
        return new AggregateError(errors, 'Compensation failed')
    }
    let targetCleanupSucceeded = !targetPointerInstalled
    if (targetPointerInstalled) {
        try {
            await triggerSourceService(log).disable({
                flowId: flow.id,
                projectId: flow.projectId,
                simulate: false,
                ignoreError: false,
            })
            targetCleanupSucceeded = true
        }
        catch (error) {
            errors.push(asError(error))
            targetCleanupSucceeded = false
        }
    }
    let pointerRestored = false
    let pointerCacheInvalidated = false
    try {
        await flowRepo().update({ id: flow.id, projectId: flow.projectId }, {
            publishedVersionId: flow.publishedVersionId,
            status: FlowStatus.DISABLED,
        })
        pointerRestored = true
    }
    catch (error) {
        errors.push(asError(error))
    }
    if (pointerRestored) {
        try {
            await flowExecutionCache(log).invalidate(flow.id)
            pointerCacheInvalidated = true
        }
        catch (error) {
            errors.push(asError(error))
            pointerCacheInvalidated = false
        }
    }
    if (targetCleanupSucceeded && pointerRestored && pointerCacheInvalidated && flow.status === FlowStatus.ENABLED && previousVersion !== null) {
        let previousTriggerEnabled = false
        try {
            const restoredFlow = await flowService(log).getOneOrThrow({ id: flow.id, projectId: flow.projectId })
            await flowSideEffects(log).preUpdateStatus({
                flowToUpdate: restoredFlow,
                publishedFlowVersion: previousVersion,
                newStatus: FlowStatus.ENABLED,
                templateId: restoredFlow.templateId ?? undefined,
                isRepublish: true,
            })
            previousTriggerEnabled = true
        }
        catch (error) {
            errors.push(asError(error))
        }
        if (previousTriggerEnabled) {
            try {
                await flowRepo().update({ id: flow.id, projectId: flow.projectId }, { status: FlowStatus.ENABLED })
            }
            catch (error) {
                errors.push(asError(error))
                try {
                    await triggerSourceService(log).disable({
                        flowId: flow.id,
                        projectId: flow.projectId,
                        simulate: false,
                        ignoreError: false,
                    })
                }
                catch (disableError) {
                    errors.push(asError(disableError))
                }
                try {
                    await flowRepo().update({ id: flow.id, projectId: flow.projectId }, { status: FlowStatus.DISABLED })
                }
                catch (resetError) {
                    errors.push(asError(resetError))
                }
            }
        }
    }
    try {
        await flowExecutionCache(log).invalidate(flow.id)
    }
    catch (error) {
        errors.push(asError(error))
    }
    if (errors.length === 0) {
        return null
    }
    return new AggregateError(errors, 'Compensation failed')
}

function activationReceipt(flow: Flow, activatedVersionId: FlowVersionId, previousPublishedVersionId: FlowVersionId | null): ActivationReceipt {
    return {
        flowId: flow.id,
        flowVersionId: activatedVersionId,
        previousPublishedVersionId,
        publishedVersionId: flow.publishedVersionId ?? null,
        status: flow.status,
        activatedAt: new Date().toISOString(),
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

function invalidOperation(message: string): never {
    throw new ActivepiecesError({
        code: ErrorCode.FLOW_OPERATION_INVALID,
        params: { message },
    }, message)
}

type ExactFlowVersionParams = {
    projectId: ProjectId
    flowId: FlowId
    flowVersionId: FlowVersionId
    skipVersionMutationLock?: boolean
}

type TestExactFlowVersionParams = ExactFlowVersionParams & {
    fixture: Record<string, unknown>
}

type ActivateExactFlowVersionParams = ExactFlowVersionParams & {
    expectedPublishedVersionId: FlowVersionId | null
}

type ActivationReceipt = {
    flowId: FlowId
    flowVersionId: FlowVersionId
    previousPublishedVersionId: FlowVersionId | null
    publishedVersionId: FlowVersionId | null
    status: FlowStatus
    activatedAt: string
}

type CompensateActivationParams = {
    log: FastifyBaseLogger
    flow: Flow
    previousVersion: FlowVersion | null
    targetPointerInstalled: boolean
    previousTriggerReconciliationRequired: boolean
}

type RestoreExactFlowVersionParams = ExactFlowVersionParams & {
    expectedLatestVersionId: FlowVersionId
    userId?: UserId
}
