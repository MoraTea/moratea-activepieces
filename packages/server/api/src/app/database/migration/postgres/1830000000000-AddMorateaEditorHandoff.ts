import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddMorateaEditorHandoff1830000000000 implements Migration {
    name = 'AddMorateaEditorHandoff1830000000000'
    breaking = false
    release = '0.88.4'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "moratea_editor_handoff" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "ticketId" character varying(255) NOT NULL,
                "bootstrapTokenHash" character varying(64) NOT NULL,
                "userId" character varying(21) NOT NULL,
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "redeemedAt" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "pk_moratea_editor_handoff" PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_moratea_editor_handoff_ticket_id"
            ON "moratea_editor_handoff" ("ticketId")
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_moratea_editor_handoff_bootstrap_token_hash"
            ON "moratea_editor_handoff" ("bootstrapTokenHash")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_moratea_editor_handoff_expires_at"
            ON "moratea_editor_handoff" ("expiresAt")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_moratea_editor_handoff_expires_at"')
        await queryRunner.query('DROP INDEX "idx_moratea_editor_handoff_bootstrap_token_hash"')
        await queryRunner.query('DROP INDEX "idx_moratea_editor_handoff_ticket_id"')
        await queryRunner.query('DROP TABLE "moratea_editor_handoff"')
    }
}
