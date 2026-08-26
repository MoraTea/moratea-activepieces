import { ErrorCode, isNil, ProjectId, spreadIfDefined, tryCatch } from '@activepieces/core-utils'
import { onCallService } from '@activepieces/server-utils'
import { FlowVersion, FlowVersionState, LATEST_FLOW_SCHEMA_VERSION } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { IsNull } from 'typeorm'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { flowVersionBackupService } from './flow-version-backup.service'
import { flowVersionRepo } from './flow-version.service'
import { flowMigrations } from './migrations'

function getAffectedRows(updateResult: unknown): number | undefined {
    if (updateResult === null || typeof updateResult !== 'object') {
        return undefined
    }
    const result = updateResult as { affected?: unknown, raw?: unknown }
    if (typeof result.affected === 'number') {
        return result.affected
    }
    if (typeof result.raw === 'number') {
        return result.raw
    }
    if (Array.isArray(result.raw) && typeof result.raw[1] === 'number') {
        return result.raw[1]
    }
    if (result.raw !== null && typeof result.raw === 'object') {
        const raw = result.raw as Record<string, unknown>
        for (const key of ['affected', 'rowCount', 'affectedRows', 'changes']) {
            if (typeof raw[key] === 'number') {
                return raw[key]
            }
        }
    }
    return undefined
}

async function migrateInMemory(log: FastifyBaseLogger, flowVersion: FlowVersion, projectId?: ProjectId): Promise<FlowVersion> {
    const { data: migratedFlowVersion, error: migrationError } = await tryCatch(() => flowMigrations.apply(flowVersion, { log, projectId }))
    if (migrationError) {
        log.error({ migrationError }, '[flowVersionMigration] Failed to migrate flow version')
        onCallService(log, system.get(AppSystemProp.PAGE_ONCALL_WEBHOOK)).page({
            code: ErrorCode.FLOW_MIGRATION_FAILED,
            message: migrationError.message,
            params: { flowVersionId: flowVersion.id },
        }).catch((pageError) => {
            log.error({ pageError }, '[flowVersionMigration] Failed to send on-call page')
        })
        throw migrationError
    }
    return migratedFlowVersion
}

export const flowVersionMigrationService = (log: FastifyBaseLogger) => ({
    async migrate(flowVersion: FlowVersion, projectId?: ProjectId): Promise<FlowVersion> {
        // Early exit if already at latest version
        if (flowVersion.schemaVersion === LATEST_FLOW_SCHEMA_VERSION) {
            return flowVersion
        }

        // LOCKED versions: migrate only in memory for legacy runtime compatibility.
        // Never persist LOCKED row bytes, backup file, or backupFiles.
        if (flowVersion.state === FlowVersionState.LOCKED) {
            log.info({ flowVersionId: flowVersion.id, schemaVersion: flowVersion.schemaVersion }, 'Migrating LOCKED flow version in memory only')
            const migratedFlowVersion = await migrateInMemory(log, flowVersion, projectId)
            log.info({ flowVersionId: flowVersion.id, schemaVersion: migratedFlowVersion.schemaVersion }, 'LOCKED flow version migration completed in memory')
            return migratedFlowVersion
        }

        log.info('Starting flow version migration')
        const originalSchemaVersion = flowVersion.schemaVersion

        const backupFiles = flowVersion.backupFiles ?? {}
        if (!isNil(flowVersion.schemaVersion)) {
            backupFiles[flowVersion.schemaVersion] = await flowVersionBackupService(log).store(flowVersion)
        }

        const migratedFlowVersion = await migrateInMemory(log, flowVersion, projectId)
        const updateResult = await flowVersionRepo().update({
            id: flowVersion.id,
            state: FlowVersionState.DRAFT,
            schemaVersion: originalSchemaVersion ?? IsNull(),
        }, {
            schemaVersion: migratedFlowVersion.schemaVersion,
            ...spreadIfDefined('trigger', migratedFlowVersion.trigger),
            connectionIds: migratedFlowVersion.connectionIds,
            agentIds: migratedFlowVersion.agentIds,
            backupFiles,
        })
        const affectedRows = getAffectedRows(updateResult)
        const casWon = affectedRows === undefined ? undefined : affectedRows > 0
        const storedFlowVersion = await flowVersionRepo().findOne({
            where: {
                id: flowVersion.id,
            },
        })
        if (storedFlowVersion) {
            if (storedFlowVersion.state === FlowVersionState.LOCKED && storedFlowVersion.schemaVersion !== LATEST_FLOW_SCHEMA_VERSION) {
                return migrateInMemory(log, storedFlowVersion, projectId)
            }
            log.info({ flowVersionId: flowVersion.id, casWon }, 'Flow version migration winner reloaded')
            return storedFlowVersion
        }
        log.warn({ flowVersionId: flowVersion.id, casWon }, 'Flow version migration winner could not be reloaded')
        log.info('Flow version migration completed')
        return migratedFlowVersion
    },
})