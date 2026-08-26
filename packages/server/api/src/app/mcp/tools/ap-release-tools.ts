import { Permission } from '@activepieces/core-utils'
import type { McpToolContext, McpToolDefinition, ProjectScopedMcpServer } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { flowService } from '../../flows/flow/flow.service'
import { exactFlowVersionService } from '../../flows/flow-version/exact-flow-version.service'
import { mcpUtils } from './mcp-utils'

const exactFlowVersionInput = z.object({
    flowId: z.string(),
    flowVersionId: z.string(),
})

const testFlowVersionInput = exactFlowVersionInput.extend({
    fixture: z.record(z.string(), z.unknown()),
})

const activateFlowVersionInput = exactFlowVersionInput.extend({
    expectedPublishedVersionId: z.string().nullable(),
})

const restoreFlowVersionInput = exactFlowVersionInput.extend({
    expectedLatestVersionId: z.string(),
})

export const apFreezeFlowVersionTool = ({ mcp }: McpToolContext, log: FastifyBaseLogger): McpToolDefinition => ({
    title: 'ap_freeze_flow_version',
    permission: Permission.WRITE_FLOW,
    description: 'Freeze one exact valid draft as an immutable locked version without changing the published version.',
    inputSchema: exactFlowVersionInput.shape,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args) => {
        try {
            const { flowId, flowVersionId } = exactFlowVersionInput.parse(args)
            const frozen = await exactFlowVersionService(log).freeze({
                projectId: mcp.projectId,
                flowId,
                flowVersionId,
            })
            const receipt = {
                flowId: frozen.flowId,
                flowVersionId: frozen.id,
                state: frozen.state,
                valid: frozen.valid,
                created: frozen.created,
                updated: frozen.updated,
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(receipt) }],
                structuredContent: receipt,
            }
        }
        catch (error) {
            return mcpUtils.mcpToolError('Freeze failed', error)
        }
    },
})

export const apGetFlowVersionTool = (mcp: ProjectScopedMcpServer, log: FastifyBaseLogger): McpToolDefinition => ({
    title: 'ap_get_flow_version',
    permission: Permission.READ_FLOW,
    description: 'Read one exact flow version by ID. This never falls back to the latest version.',
    inputSchema: exactFlowVersionInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (args) => {
        try {
            const { flowId, flowVersionId } = exactFlowVersionInput.parse(args)
            const flowVersion = await exactFlowVersionService(log).get({
                projectId: mcp.projectId,
                flowId,
                flowVersionId,
            })
            const flow = await flowService(log).getOneOrThrow({
                id: flowId,
                projectId: mcp.projectId,
            })
            const receipt = {
                flowId: flowVersion.flowId,
                flowVersionId: flowVersion.id,
                displayName: flowVersion.displayName,
                state: flowVersion.state,
                valid: flowVersion.valid,
                created: flowVersion.created,
                updated: flowVersion.updated,
                currentPublishedVersionId: flow.publishedVersionId,
                flowStatus: flow.status,
                flowVersion,
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(receipt) }],
                structuredContent: receipt,
            }
        }
        catch (error) {
            return mcpUtils.mcpToolError('Read exact flow version failed', error)
        }
    },
})

export const apTestFlowVersionTool = ({ mcp }: McpToolContext, log: FastifyBaseLogger): McpToolDefinition => ({
    title: 'ap_test_flow_version',
    permission: Permission.WRITE_RUN,
    description: 'Queue a test-environment run for one exact locked flow version using the supplied trigger fixture.',
    inputSchema: testFlowVersionInput.shape,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    execute: async (args) => {
        try {
            const { flowId, flowVersionId, fixture } = testFlowVersionInput.parse(args)
            const run = await exactFlowVersionService(log).test({
                projectId: mcp.projectId,
                flowId,
                flowVersionId,
                fixture,
            })
            const receipt = {
                runId: run.id,
                flowId: run.flowId,
                flowVersionId: run.flowVersionId,
                environment: run.environment,
                status: run.status,
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(receipt) }],
                structuredContent: receipt,
            }
        }
        catch (error) {
            return mcpUtils.mcpToolError('Exact flow-version test failed', error)
        }
    },
})

export const apActivateFlowVersionTool = ({ mcp }: McpToolContext, log: FastifyBaseLogger): McpToolDefinition => ({
    title: 'ap_activate_flow_version',
    permission: Permission.UPDATE_FLOW_STATUS,
    description: 'Activate one exact locked flow version only when the current published version matches the supplied expectation.',
    inputSchema: activateFlowVersionInput.shape,
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    execute: async (args) => {
        try {
            const { flowId, flowVersionId, expectedPublishedVersionId } = activateFlowVersionInput.parse(args)
            const receipt = await exactFlowVersionService(log).activate({
                projectId: mcp.projectId,
                flowId,
                flowVersionId,
                expectedPublishedVersionId,
            })
            return {
                content: [{ type: 'text', text: JSON.stringify(receipt) }],
                structuredContent: receipt,
            }
        }
        catch (error) {
            return mcpUtils.mcpToolError('Exact flow-version activation failed', error)
        }
    },
})

export const apRestoreFlowVersionAsDraftTool = ({ mcp, userId }: McpToolContext, log: FastifyBaseLogger): McpToolDefinition => ({
    title: 'ap_restore_flow_version_as_draft',
    permission: Permission.WRITE_FLOW,
    description: 'Copy one exact locked flow version into a new draft without modifying the source version.',
    inputSchema: restoreFlowVersionInput.shape,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args) => {
        try {
            const { flowId, flowVersionId, expectedLatestVersionId } = restoreFlowVersionInput.parse(args)
            const restored = await exactFlowVersionService(log).restoreAsDraft({
                projectId: mcp.projectId,
                flowId,
                flowVersionId,
                expectedLatestVersionId,
                userId,
            })
            const receipt = {
                flowId: restored.flowId,
                sourceFlowVersionId: flowVersionId,
                flowVersionId: restored.id,
                state: restored.state,
                valid: restored.valid,
                created: restored.created,
                updated: restored.updated,
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(receipt) }],
                structuredContent: receipt,
            }
        }
        catch (error) {
            return mcpUtils.mcpToolError('Restore exact flow version failed', error)
        }
    },
})
