import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../database/database-common'

export const MorateaEditorHandoffEntity = new EntitySchema<MorateaEditorHandoffSchema>({
    name: 'moratea_editor_handoff',
    columns: {
        ...BaseColumnSchemaPart,
        ticketId: {
            type: String,
            length: 255,
            nullable: false,
        },
        bootstrapTokenHash: {
            type: String,
            length: 64,
            nullable: false,
        },
        userId: {
            ...ApIdSchema,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        flowId: {
            ...ApIdSchema,
            nullable: false,
        },
        expiresAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        redeemedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_moratea_editor_handoff_ticket_id',
            columns: ['ticketId'],
            unique: true,
        },
        {
            name: 'idx_moratea_editor_handoff_bootstrap_token_hash',
            columns: ['bootstrapTokenHash'],
            unique: true,
        },
        {
            name: 'idx_moratea_editor_handoff_expires_at',
            columns: ['expiresAt'],
        },
    ],
})

export type MorateaEditorHandoffSchema = {
    id: string
    created: Date
    updated: Date
    ticketId: string
    bootstrapTokenHash: string
    userId: string
    platformId: string
    projectId: string
    flowId: string
    expiresAt: Date
    redeemedAt: Date | null
}
