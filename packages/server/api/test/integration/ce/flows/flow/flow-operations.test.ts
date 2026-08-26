import {
    FlowActionType,
    flowOperations,
    FlowOperationStatus,
    FlowOperationType,
    FlowStatus,
    FlowTriggerType,
    FlowVersion,
    FlowVersionState,
    PackageType,
    PieceType,
    PopulatedFlow,
    StepLocationRelativeToParent,
    TriggerStrategy,
    TriggerTestStrategy,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { flowService } from '../../../../../src/app/flows/flow/flow.service'
import * as flowVersionValidatorModule from '../../../../../src/app/flows/flow-version/flow-version-validator-util'
import { db } from '../../../../helpers/db'
import { describeWithAuth } from '../../../../helpers/describe-with-auth'
import {
    createMockFlow,
    createMockFlowVersion,
    createMockFolder,
    createMockPieceMetadata,
} from '../../../../helpers/mocks'
import { createTestContext } from '../../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Flow Operations API', () => {
    describeWithAuth('GET /v1/flows/:id', () => app!, (setup) => {
        it('should get a flow by id', async () => {
            const ctx = await setup()

            const mockFlow = createMockFlow({ projectId: ctx.project.id })
            await db.save('flow', mockFlow)

            const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id })
            await db.save('flow_version', mockFlowVersion)

            const response = await ctx.get(`/v1/flows/${mockFlow.id}`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.id).toBe(mockFlow.id)
            expect(body.projectId).toBe(ctx.project.id)
            expect(body.version).toBeDefined()
            expect(body.version.id).toBe(mockFlowVersion.id)
        })

        it('should return 404 for non-existent flow', async () => {
            const ctx = await setup()

            const response = await ctx.get('/v1/flows/nonExistentId12345678')

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })

    describe('GET /v1/flows/:id (Cross-project)', () => {
        it('should deny access for flow in another project', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)

            const mockFlow = createMockFlow({ projectId: ctx1.project.id })
            await db.save('flow', mockFlow)

            const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id })
            await db.save('flow_version', mockFlowVersion)

            const response = await ctx2.get(`/v1/flows/${mockFlow.id}`)

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describeWithAuth('GET /v1/flows/count', () => app!, (setup) => {
        it('should count flows in project', async () => {
            const ctx = await setup()

            const mockFlow1 = createMockFlow({ projectId: ctx.project.id })
            const mockFlow2 = createMockFlow({ projectId: ctx.project.id })
            await db.save('flow', [mockFlow1, mockFlow2])

            const mockFlowVersion1 = createMockFlowVersion({ flowId: mockFlow1.id })
            const mockFlowVersion2 = createMockFlowVersion({ flowId: mockFlow2.id })
            await db.save('flow_version', [mockFlowVersion1, mockFlowVersion2])

            const response = await ctx.get('/v1/flows/count', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body).toBe(2)
        })
    })

    describeWithAuth('DELETE /v1/flows/:id', () => app!, (setup) => {
        it('should delete a flow', async () => {
            const ctx = await setup()

            const mockFlow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
            await db.save('flow', mockFlow)

            const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id })
            await db.save('flow_version', mockFlowVersion)

            const response = await ctx.delete(`/v1/flows/${mockFlow.id}`)

            expect(response?.statusCode).toBe(StatusCodes.NO_CONTENT)

            // Verify the flow no longer appears in list
            const listResponse = await ctx.get('/v1/flows', { projectId: ctx.project.id })
            const flows = listResponse?.json().data ?? []
            const flowIds = flows.map((f: Record<string, string>) => f.id)
            expect(flowIds).not.toContain(mockFlow.id)
        })

        it('should return 404 when deleting non-existent flow', async () => {
            const ctx = await setup()

            const response = await ctx.delete('/v1/flows/nonExistentId12345678')

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })

    describe('DELETE /v1/flows/:id (Cross-project)', () => {
        it('should deny deleting flow from another project', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)

            const mockFlow = createMockFlow({ projectId: ctx1.project.id, status: FlowStatus.DISABLED })
            await db.save('flow', mockFlow)

            const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id })
            await db.save('flow_version', mockFlowVersion)

            const response = await ctx2.delete(`/v1/flows/${mockFlow.id}`)

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describeWithAuth('POST /v1/flows/:id CHANGE_NAME', () => app!, (setup) => {
        it('should rename a flow', async () => {
            const ctx = await setup()

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'Original Name',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })

            expect(createResponse?.statusCode).toBe(StatusCodes.CREATED)
            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'New Name' },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.displayName).toBe('New Name')
        })
    })

    describe('POST /v1/flows/:id CHANGE_FOLDER', () => {
        it('should move flow to folder', async () => {
            const ctx = await createTestContext(app!)

            const mockFolder = createMockFolder({ projectId: ctx.project.id })
            await db.save('folder', mockFolder)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })

            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.CHANGE_FOLDER,
                request: { folderId: mockFolder.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.folderId).toBe(mockFolder.id)
        })

        it('should move flow to null (unfolder)', async () => {
            const ctx = await createTestContext(app!)

            const mockFolder = createMockFolder({ projectId: ctx.project.id })
            await db.save('folder', mockFolder)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
                folderId: mockFolder.id,
            }, { query: { projectId: ctx.project.id } })

            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.CHANGE_FOLDER,
                request: { folderId: null },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.folderId).toBeNull()
        })
    })

    describe('POST /v1/flows/:id UPDATE_TRIGGER', () => {
        it('should update trigger to piece trigger', async () => {
            const ctx = await createTestContext(app!)

            const mockPiece = createMockPieceMetadata({
                name: '@activepieces/piece-schedule',
                version: '0.2.0',
                pieceType: PieceType.OFFICIAL,
                packageType: PackageType.REGISTRY,
            })
            await db.save('piece_metadata', mockPiece)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })

            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.UPDATE_TRIGGER,
                request: {
                    type: FlowTriggerType.PIECE,
                    settings: {
                        pieceName: '@activepieces/piece-schedule',
                        pieceVersion: '0.2.0',
                        input: {},
                        triggerName: 'every_hour',
                        propertySettings: {},
                    },
                    valid: false,
                    name: 'trigger',
                    displayName: 'Schedule',
                },
            })
            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.type).toBe(FlowTriggerType.PIECE)
            expect(body.version.trigger.settings.pieceName).toBe('@activepieces/piece-schedule')
        })
    })

    describeWithAuth('POST /v1/flows/:id ADD_ACTION', () => app!, (setup) => {
        it('should add code action after trigger', async () => {
            const ctx = await setup()

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })

            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Code Step',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return true; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction).toBeDefined()
            expect(body.version.trigger.nextAction.type).toBe(FlowActionType.CODE)
            expect(body.version.trigger.nextAction.displayName).toBe('Code Step')
        })
    })

    describe('POST /v1/flows/:id UPDATE_ACTION', () => {
        it('should update action settings', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Code Step',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return true; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    type: FlowActionType.CODE,
                    displayName: 'Updated Code Step',
                    name: 'step_1',
                    settings: {
                        input: { key: 'value' },
                        sourceCode: {
                            code: 'export const code = async () => { return false; }',
                            packageJson: '{}',
                        },
                    },
                    valid: true,
                    skip: false,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction.displayName).toBe('Updated Code Step')
        })

        it('should preserve settings.input for CODE action', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Code Step',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return true; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const inputData = { key: 'value', nested: { a: 1 } }
            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    type: FlowActionType.CODE,
                    displayName: 'Code Step',
                    name: 'step_1',
                    settings: {
                        input: inputData,
                        sourceCode: {
                            code: 'export const code = async () => { return true; }',
                            packageJson: '{}',
                        },
                    },
                    valid: true,
                    skip: false,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction.settings.input).toEqual(inputData)
        })

        it('should preserve settings.input for PIECE action', async () => {
            const ctx = await createTestContext(app!)

            const mockPiece = createMockPieceMetadata({
                name: '@activepieces/piece-test',
                version: '0.1.0',
                pieceType: PieceType.OFFICIAL,
                packageType: PackageType.REGISTRY,
            })
            await db.save('piece_metadata', mockPiece)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.PIECE,
                        displayName: 'Piece Step',
                        name: 'step_1',
                        settings: {
                            pieceName: '@activepieces/piece-test',
                            pieceVersion: '0.1.0',
                            actionName: 'test_action',
                            input: {},
                            propertySettings: {},
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const inputData = { field1: 'hello', field2: '{{ trigger.body }}' }
            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    type: FlowActionType.PIECE,
                    displayName: 'Piece Step',
                    name: 'step_1',
                    settings: {
                        pieceName: '@activepieces/piece-test',
                        pieceVersion: '0.1.0',
                        actionName: 'test_action',
                        input: inputData,
                        propertySettings: {},
                    },
                    valid: true,
                    skip: false,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction.settings.input).toEqual(inputData)
        })
    })

    describe('POST /v1/flows/:id DELETE_ACTION', () => {
        it('should delete action by name', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Code Step',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return true; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.DELETE_ACTION,
                request: { names: ['step_1'] },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction).toBeUndefined()
        })
    })

    describe('POST /v1/flows/:id DUPLICATE_ACTION', () => {
        it('should duplicate an action', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Code Step',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return true; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.DUPLICATE_ACTION,
                request: { stepName: 'step_1' },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction).toBeDefined()
            expect(body.version.trigger.nextAction.nextAction).toBeDefined()
        })
    })

    describe('POST /v1/flows/:id MOVE_ACTION', () => {
        it('should move action to different position', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Step 1',
                        name: 'step_1',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return 1; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'step_1',
                    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                    action: {
                        type: FlowActionType.CODE,
                        displayName: 'Step 2',
                        name: 'step_2',
                        settings: {
                            input: {},
                            sourceCode: {
                                code: 'export const code = async () => { return 2; }',
                                packageJson: '{}',
                            },
                        },
                        valid: true,
                        skip: false,
                    },
                },
            })

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_2',
                    newParentStep: 'trigger',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.trigger.nextAction.displayName).toBe('Step 2')
        })
    })

    describe('POST /v1/flows/:id IMPORT_FLOW', () => {
        it('should import flow definition', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.IMPORT_FLOW,
                request: {
                    displayName: 'Imported Flow',
                    trigger: {
                        type: FlowTriggerType.EMPTY,
                        name: 'trigger',
                        settings: {},
                        valid: false,
                        displayName: 'Select Trigger',
                    },
                    schemaVersion: null,
                    notes: null,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.version.displayName).toBe('Imported Flow')
            expect(body.version.state).toBe(FlowVersionState.DRAFT)
        })

        it('rejects an imported flow whose nested step name is a path traversal', async () => {
            const ctx = await createTestContext(app!)

            const createResponse = await ctx.post('/v1/flows', {
                displayName: 'test flow',
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
            const flow: PopulatedFlow = createResponse?.json()

            const response = await ctx.post(`/v1/flows/${flow.id}`, {
                type: FlowOperationType.IMPORT_FLOW,
                request: {
                    displayName: 'Malicious Flow',
                    trigger: {
                        type: FlowTriggerType.EMPTY,
                        name: 'trigger',
                        displayName: 'Select Trigger',
                        settings: {},
                        valid: false,
                        nextAction: {
                            type: FlowActionType.CODE,
                            displayName: 'Code Step',
                            name: '../../common/node_modules/bufferutil',
                            settings: {
                                input: {},
                                sourceCode: {
                                    code: 'export const code = async () => { return true; }',
                                    packageJson: '{}',
                                },
                            },
                            valid: true,
                            skip: false,
                        },
                    },
                    schemaVersion: null,
                    notes: null,
                },
            })

            // ErrorCode.VALIDATION maps to 409 in the API error handler (the convention for
            // rejected-invalid-input across the codebase); the point is the import is rejected
            // and the traversal name is never persisted.
            expect(response?.statusCode).toBe(StatusCodes.CONFLICT)

            // The traversal step must never reach the flow version.
            const afterImport = await ctx.get(`/v1/flows/${flow.id}`)
            const persisted: PopulatedFlow = afterImport?.json()
            expect(persisted.version.trigger.nextAction).toBeUndefined()
        })
    })

    describe('POST /v1/flows/:id draft creation rollback', () => {
        it('should not leave an orphaned empty draft when importing into the new draft fails', async () => {
            const ctx = await createTestContext(app!)

            const mockFlow = createMockFlow({
                projectId: ctx.project.id,
                status: FlowStatus.DISABLED,
            })
            await db.save('flow', mockFlow)

            const lockedVersion = createMockFlowVersion({
                flowId: mockFlow.id,
                state: FlowVersionState.LOCKED,
                valid: true,
            })
            await db.save('flow_version', lockedVersion)

            const applySpy = vi.spyOn(flowOperations, 'apply').mockImplementationOnce(() => {
                throw new RangeError('Maximum call stack size exceeded')
            })

            try {
                const response = await ctx.post(`/v1/flows/${mockFlow.id}`, {
                    type: FlowOperationType.CHANGE_NAME,
                    request: { displayName: 'New Name' },
                })

                expect(response?.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR)

                const orphanedDraft = await db.findOneBy('flow_version', {
                    flowId: mockFlow.id,
                    state: FlowVersionState.DRAFT,
                })
                expect(orphanedDraft).toBeNull()

                const remainingVersion = await db.findOneByOrFail<FlowVersion>('flow_version', {
                    flowId: mockFlow.id,
                })
                expect(remainingVersion.id).toBe(lockedVersion.id)
                expect(remainingVersion.state).toBe(FlowVersionState.LOCKED)
            }
            finally {
                applySpy.mockRestore()
            }
        })

        it('should delete the newly created draft when the user operation fails after a successful import', async () => {
            const ctx = await createTestContext(app!)

            const mockFlow = createMockFlow({
                projectId: ctx.project.id,
                status: FlowStatus.DISABLED,
            })
            await db.save('flow', mockFlow)

            const lockedVersion = createMockFlowVersion({
                flowId: mockFlow.id,
                state: FlowVersionState.LOCKED,
                valid: true,
            })
            await db.save('flow_version', lockedVersion)

            const originalApply = flowOperations.apply
            const applySpy = vi.spyOn(flowOperations, 'apply').mockImplementation((flowVersion, operation) => {
                if (operation.type === FlowOperationType.CHANGE_NAME && operation.request.displayName === 'Renamed by user') {
                    throw new Error('user operation failed')
                }
                return originalApply(flowVersion, operation)
            })

            try {
                const response = await ctx.post(`/v1/flows/${mockFlow.id}`, {
                    type: FlowOperationType.CHANGE_NAME,
                    request: { displayName: 'Renamed by user' },
                })

                expect(response?.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR)

                const leftoverDraft = await db.findOneBy('flow_version', {
                    flowId: mockFlow.id,
                    state: FlowVersionState.DRAFT,
                })
                expect(leftoverDraft).toBeNull()

                const remainingVersion = await db.findOneByOrFail<FlowVersion>('flow_version', {
                    flowId: mockFlow.id,
                })
                expect(remainingVersion.id).toBe(lockedVersion.id)
                expect(remainingVersion.state).toBe(FlowVersionState.LOCKED)
            }
            finally {
                applySpy.mockRestore()
            }
        })
    })

    describe('GET /v1/flows/:flowId/versions', () => {
        it('should list flow versions', async () => {
            const ctx = await createTestContext(app!)

            const mockFlow = createMockFlow({ projectId: ctx.project.id })
            await db.save('flow', mockFlow)

            const mockFlowVersion = createMockFlowVersion({
                flowId: mockFlow.id,
                state: FlowVersionState.DRAFT,
            })
            await db.save('flow_version', mockFlowVersion)

            const response = await ctx.get(`/v1/flows/${mockFlow.id}/versions`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.data).toHaveLength(1)
            expect(body.data[0].id).toBe(mockFlowVersion.id)
        })
    })

    describe('flow version mutation lock', () => {
        it('serializes CHANGE_STATUS with author edits via per-flow lock', async () => {
            const ctx = await createTestContext(app!)
            const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
            await db.save('flow', flow)
            const published = createMockFlowVersion({
                flowId: flow.id,
                state: FlowVersionState.LOCKED,
                valid: true,
                trigger: {
                    type: FlowTriggerType.PIECE,
                    name: 'trigger',
                    displayName: 'Trigger',
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
            const draft = createMockFlowVersion({
                flowId: flow.id,
                state: FlowVersionState.DRAFT,
                valid: true,
                trigger: {
                    type: FlowTriggerType.PIECE,
                    name: 'trigger',
                    displayName: 'Trigger',
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
                created: new Date(Date.now() + 1000).toISOString(),
            })
            await db.save('flow_version', [published, draft])
            await db.update('flow', flow.id, { publishedVersionId: published.id })
            await db.save('piece_metadata', createMockPieceMetadata({
                name: '@activepieces/piece-schedule',
                version: '0.1.5',
                pieceType: PieceType.OFFICIAL,
                packageType: PackageType.REGISTRY,
                triggers: {
                    every_hour: {
                        name: 'every_hour',
                        displayName: 'Every Hour',
                        description: '',
                        requireAuth: false,
                        props: {},
                        type: TriggerStrategy.POLLING,
                        sampleData: {},
                        testStrategy: TriggerTestStrategy.TEST_FUNCTION,
                    },
                },
            }))

            const { promise: validationEntered, resolve: validationEnteredResolve } = Promise.withResolvers<undefined>()
            const { promise: validationRelease, resolve: releaseValidation } = Promise.withResolvers<undefined>()
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

            try {
                const editPromise = flowService(app!.log).update({
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

                let statusSettled = false
                const statusPromise = flowService(app!.log).update({
                    id: flow.id,
                    userId: ctx.user.id,
                    projectId: ctx.project.id,
                    platformId: ctx.project.platformId,
                    operation: {
                        type: FlowOperationType.CHANGE_STATUS,
                        request: { status: FlowStatus.ENABLED },
                    },
                }).then((res) => {
                    statusSettled = true
                    return res
                })
                // Distributed lock exposes no wait event; this probes whether status escaped before gate release.
                // Real delay required: lock has no observable wait event, so we probe with a short real wait.
                const { promise: statusDelay, resolve: resolveStatusDelay } = Promise.withResolvers<undefined>()
                setTimeout(() => resolveStatusDelay(undefined), 50)
                await statusDelay
                expect(statusSettled).toBe(false)
                releaseValidation(undefined)
                const [edited, statusRes] = await Promise.all([editPromise, statusPromise])
                expect(edited.version.displayName).toBe('serialized edit')
                expect(statusRes.status).toBe(FlowStatus.ENABLED)
                const flowAfter = await db.findOneByOrFail('flow', { id: flow.id })
                expect(flowAfter.status).toBe(FlowStatus.ENABLED)
            }
            finally {
                releaseValidation(undefined)
                validationSpy.mockRestore()
            }
        })

        it('serializes DELETE with author edits via per-flow lock', async () => {
            const ctx = await createTestContext(app!)
            const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
            await db.save('flow', flow)
            const draft = createMockFlowVersion({
                flowId: flow.id,
                state: FlowVersionState.DRAFT,
                valid: true,
                trigger: {
                    type: FlowTriggerType.PIECE,
                    name: 'trigger',
                    displayName: 'Trigger',
                    valid: true,
                    lastUpdatedDate: new Date().toISOString(),
                    settings: {
                        pieceName: '@activepieces/piece-schedule',
                        pieceVersion: '0.0.1',
                        triggerName: 'test',
                        input: {},
                        propertySettings: {},
                    },
                },
            })
            await db.save('flow_version', draft)

            const { promise: validationEntered, resolve: validationEnteredResolve } = Promise.withResolvers<undefined>()
            const { promise: validationRelease, resolve: releaseValidation } = Promise.withResolvers<undefined>()
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

            try {
                const editPromise = flowService(app!.log).update({
                    id: flow.id,
                    userId: ctx.user.id,
                    projectId: ctx.project.id,
                    platformId: ctx.project.platformId,
                    operation: {
                        type: FlowOperationType.CHANGE_NAME,
                        request: { displayName: 'edit before delete' },
                    },
                })
                await validationEntered

                let deleteSettled = false
                const deletePromise = flowService(app!.log).delete({
                    id: flow.id,
                    projectId: ctx.project.id,
                }).then(() => {
                    deleteSettled = true
                })

                // Distributed lock exposes no wait event; this probes whether delete escaped before gate release.
                // Real delay required: lock has no observable wait event, so we probe with a short real wait.
                const { promise: deleteDelay, resolve: resolveDeleteDelay } = Promise.withResolvers<undefined>()
                setTimeout(() => resolveDeleteDelay(undefined), 50)
                await deleteDelay
                expect(deleteSettled).toBe(false)

                releaseValidation(undefined)
                await editPromise
                await deletePromise

                const flowAfter = await db.findOneBy('flow', { id: flow.id })
                expect(flowAfter?.operationStatus).toBe(FlowOperationStatus.DELETING)
            }
            finally {
                releaseValidation(undefined)
                validationSpy.mockRestore()
            }
        })

        it('deletes via per-flow lock without deadlock when skip flag is set', async () => {
            const ctx = await createTestContext(app!)
            const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
            await db.save('flow', flow)
            const draft = createMockFlowVersion({ flowId: flow.id, state: FlowVersionState.DRAFT })
            await db.save('flow_version', draft)

            await flowService(app!.log).delete({
                id: flow.id,
                projectId: ctx.project.id,
                skipVersionMutationLock: true,
            })

            const after = await db.findOneBy('flow', { id: flow.id })
            expect(after?.operationStatus).toBe(FlowOperationStatus.DELETING)
        })
    })
})
