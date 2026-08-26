import {
    FlowActionType,
    FlowOperationType,
    FlowTriggerType,
    FlowVersionState,
    LATEST_FLOW_SCHEMA_VERSION,
    PieceTrigger,
    SampleDataSettings,
} from '@activepieces/shared'
import type { FlowVersion } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FlowVersionMigrationModule from '../../../../../src/app/flows/flow-version/flow-version-migration.service'

const mockGetPiece = vi.fn()
const mockGetPlatformId = vi.fn().mockResolvedValue('platform-1')
const mockRepoFindOne = vi.fn()
const mockRepoSave = vi.fn()
const mockRepoExists = vi.fn()
const mockRepoUpdate = vi.fn()
const mockMigrationsApply = vi.fn()
const mockBackupStore = vi.fn()

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        findOne: mockRepoFindOne,
        save: mockRepoSave,
        exists: mockRepoExists,
        update: mockRepoUpdate,
    })),
}))

vi.mock('../../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: vi.fn(() => ({
        get: mockGetPiece,
    })),
}))

vi.mock('../../../../../src/app/project/project-service', () => ({
    projectService: vi.fn(() => ({
        getPlatformId: mockGetPlatformId,
    })),
}))

vi.mock('../../../../../src/app/user/user-service', () => ({
    userService: vi.fn(() => ({
        getMetaInformation: vi.fn(),
    })),
}))

vi.mock('../../../../../src/app/flows/step-run/sample-data.service', () => ({
    sampleDataService: vi.fn(() => ({
        saveSampleDataFileIdsInStep: vi.fn(),
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-migration.service', () => ({
    flowVersionMigrationService: vi.fn(() => ({
        migrate: vi.fn((v: FlowVersion) => Promise.resolve(v)),
    })),
}))
vi.mock('../../../../../src/app/flows/flow-version/migrations', () => ({
    flowMigrations: {
        apply: mockMigrationsApply,
    },
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-backup.service', () => ({
    flowVersionBackupService: vi.fn(() => ({
        store: mockBackupStore,
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-side-effects', () => ({
    flowVersionSideEffects: vi.fn(() => ({
        preApplyOperation: vi.fn(),
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-validator-util', () => ({
    flowVersionValidationUtil: vi.fn(() => ({
        prepareRequest: vi.fn(({ request }: { request: unknown }) => Promise.resolve(request)),
    })),
}))

import { flowVersionService } from '../../../../../src/app/flows/flow-version/flow-version.service'

const mockLog = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

function makePieceTriggerSettings(extras: Partial<PieceTrigger['settings']> = {}): PieceTrigger['settings'] {
    return {
        pieceName: '@activepieces/piece-gmail',
        pieceVersion: '~0.1.0',
        triggerName: 'new_email',
        input: {},
        propertySettings: {},
        ...extras,
    }
}

function makeFlowVersion(overrides: { id?: string, trigger?: FlowVersion['trigger'] } = {}): FlowVersion {
    return {
        id: overrides.id ?? 'fv-1',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flow-1',
        displayName: 'Test Flow',
        trigger: overrides.trigger ?? {
            name: 'trigger',
            valid: true,
            displayName: 'Gmail Trigger',
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            type: FlowTriggerType.PIECE,
            settings: makePieceTriggerSettings(),
            nextAction: {
                name: 'step_1',
                valid: true,
                displayName: 'Slack Action',
                lastUpdatedDate: '2024-01-01T00:00:00Z',
                type: FlowActionType.PIECE,
                settings: {
                    pieceName: '@activepieces/piece-slack',
                    pieceVersion: '~0.2.0',
                    actionName: 'send_message',
                    input: {},
                    propertySettings: {},
                },
            },
        },
        updatedBy: null,
        valid: true,
        schemaVersion: null,
        agentIds: [],
        state: FlowVersionState.DRAFT,
        connectionIds: [],
        backupFiles: null,
        notes: [],
    }
}

describe('flowVersionService.applyOperation - USE_AS_DRAFT', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetPlatformId.mockResolvedValue('platform-1')
        mockRepoFindOne.mockResolvedValue(null)
        mockRepoSave.mockImplementation((v: FlowVersion) => Promise.resolve(v))
        mockRepoExists.mockResolvedValue(false)
    })

    it('preserves PIECE trigger sample data from the previous version', async () => {
        const sampleData: SampleDataSettings = {
            sampleDataFileId: 'sd-file-1',
            sampleDataInputFileId: 'sdi-file-1',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                ...makeFlowVersion().trigger,
                settings: makePieceTriggerSettings({ sampleData }),
            } as PieceTrigger,
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.PIECE)
        const settings = (result.trigger as PieceTrigger).settings
        expect(settings.sampleData?.sampleDataFileId).toBe(sampleData.sampleDataFileId)
        expect(settings.sampleData?.sampleDataInputFileId).toBe(sampleData.sampleDataInputFileId)
    })

    it('does not set trigger sample data when previous version has no sampleData', async () => {
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({ id: 'fv-prev' })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.PIECE)
        expect((result.trigger as PieceTrigger).settings.sampleData).toBeUndefined()
    })

    it('skips the sample data preservation when previous version has an EMPTY trigger', async () => {
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                name: 'trigger',
                valid: false,
                displayName: 'Select Trigger',
                lastUpdatedDate: '2024-01-01T00:00:00Z',
                type: FlowTriggerType.EMPTY,
                settings: {},
            },
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.EMPTY)
    })
})

describe('flowVersionMigrationService persistence CAS', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockBackupStore.mockResolvedValue({})
        mockRepoUpdate.mockResolvedValue(undefined)
        mockRepoFindOne.mockReset()
    })

    it('does not overwrite a row locked after the stale draft was read', async () => {
        const staleDraft = makeFlowVersion({ id: 'fv-stale' })
        const persistedRow = { ...staleDraft, state: FlowVersionState.LOCKED }
        const migratedFlowVersion = {
            ...staleDraft,
            schemaVersion: LATEST_FLOW_SCHEMA_VERSION,
            connectionIds: ['connection-migrated'],
            agentIds: ['agent-migrated'],
        }
        mockMigrationsApply.mockResolvedValue(migratedFlowVersion)
        mockRepoFindOne.mockResolvedValue(persistedRow)
        mockRepoUpdate.mockImplementation(async (criteria: { id: string, state?: FlowVersionState, schemaVersion?: unknown }, fields: Partial<FlowVersion>) => {
            const schemaMatches = criteria.schemaVersion !== null && typeof criteria.schemaVersion === 'object' && '_type' in criteria.schemaVersion && criteria.schemaVersion._type === 'isNull'
            if (criteria.id === persistedRow.id && criteria.state === FlowVersionState.DRAFT && schemaMatches && persistedRow.state === FlowVersionState.DRAFT && persistedRow.schemaVersion === null) {
                Object.assign(persistedRow, fields)
            }
            // Simulate a driver that omits UpdateResult.affected.
            return undefined
        })

        const { flowVersionMigrationService: actualMigrationService } = await vi.importActual<typeof FlowVersionMigrationModule>(
            '../../../../../src/app/flows/flow-version/flow-version-migration.service',
        )
        await actualMigrationService(mockLog).migrate(staleDraft)

        const updateCriteria = mockRepoUpdate.mock.calls[0][0] as { schemaVersion?: { _type?: string } }
        expect(updateCriteria.schemaVersion?._type).toBe('isNull')
        expect(mockRepoUpdate).toHaveBeenCalledTimes(1)
        expect(mockRepoUpdate).toHaveBeenCalledWith({
            id: staleDraft.id,
            state: FlowVersionState.DRAFT,
            schemaVersion: expect.objectContaining({ _type: 'isNull' }),
        }, expect.objectContaining({
            schemaVersion: LATEST_FLOW_SCHEMA_VERSION,
            connectionIds: migratedFlowVersion.connectionIds,
            agentIds: migratedFlowVersion.agentIds,
        }))
        expect(persistedRow).toMatchObject({
            state: FlowVersionState.LOCKED,
            schemaVersion: staleDraft.schemaVersion,
            connectionIds: staleDraft.connectionIds,
            agentIds: staleDraft.agentIds,
        })
    })
    it('returns a concurrently edited draft instead of overwriting its trigger', async () => {
        const staleDraft = makeFlowVersion({ id: 'fv-stale-draft' })
        const persistedRow = { ...staleDraft }
        const newerDraft = {
            ...staleDraft,
            schemaVersion: LATEST_FLOW_SCHEMA_VERSION,
            trigger: { ...staleDraft.trigger, name: 'newer-trigger' },
        }
        const migratedFlowVersion = {
            ...staleDraft,
            schemaVersion: LATEST_FLOW_SCHEMA_VERSION,
            trigger: { ...staleDraft.trigger, name: 'stale-migrated-trigger' },
        }
        mockMigrationsApply.mockResolvedValue(migratedFlowVersion)
        mockRepoFindOne.mockResolvedValue(persistedRow)
        mockRepoUpdate.mockImplementation(async (criteria: { id: string, state?: FlowVersionState, schemaVersion?: unknown }, fields: Partial<FlowVersion>) => {
            // A newer draft edit commits while this stale migration is in flight.
            Object.assign(persistedRow, newerDraft)
            const schemaMatches = criteria.schemaVersion !== null && typeof criteria.schemaVersion === 'object' && '_type' in criteria.schemaVersion && criteria.schemaVersion._type === 'isNull'
            if (criteria.id === persistedRow.id && criteria.state === FlowVersionState.DRAFT && schemaMatches && persistedRow.schemaVersion === null) {
                Object.assign(persistedRow, fields)
                return { affected: 1 }
            }
            return { affected: 0, raw: { affectedRows: 0 } }
        })

        const { flowVersionMigrationService: actualMigrationService } = await vi.importActual<typeof FlowVersionMigrationModule>(
            '../../../../../src/app/flows/flow-version/flow-version-migration.service',
        )
        const result = await actualMigrationService(mockLog).migrate(staleDraft)

        expect(result.schemaVersion).toBe(LATEST_FLOW_SCHEMA_VERSION)
        expect(result.trigger.name).toBe('newer-trigger')
        expect(persistedRow.trigger.name).toBe('newer-trigger')
        expect(mockRepoUpdate).toHaveBeenCalledTimes(1)
    })
})
