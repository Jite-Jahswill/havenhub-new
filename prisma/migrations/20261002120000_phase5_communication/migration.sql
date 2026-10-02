-- Phase 5: conversations, participants (read cursors), messages (seq, idempotency
-- keys, soft delete), edit revisions, private attachments and reactions. Additive only.

-- CreateEnum
CREATE TYPE "ConversationContextType" AS ENUM ('PROPERTY', 'BOOKING');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('CUSTOMER', 'AGENT', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'FILE');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "context_type" "ConversationContextType" NOT NULL,
    "property_id" UUID,
    "booking_id" UUID,
    "context_key" VARCHAR(160) NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "closed_reason" VARCHAR(500),
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_message_id" UUID,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMPTZ(3),
    "last_notified_seq" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "sender_id" UUID,
    "type" "MessageType" NOT NULL,
    "body" VARCHAR(4000),
    "reply_to_id" UUID,
    "client_key" VARCHAR(64),
    "metadata" JSONB,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_revisions" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "body" VARCHAR(4000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "message_id" UUID,
    "kind" "AttachmentKind" NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "thumbnail_key" VARCHAR(300),
    "content_type" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(160) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_context_key_key" ON "conversations"("context_key");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_last_message_id_key" ON "conversations"("last_message_id");

-- CreateIndex
CREATE INDEX "conversations_last_activity_at_id_idx" ON "conversations"("last_activity_at" DESC, "id");

-- CreateIndex
CREATE INDEX "conversations_property_id_idx" ON "conversations"("property_id");

-- CreateIndex
CREATE INDEX "conversations_booking_id_idx" ON "conversations"("booking_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_archived_at_idx" ON "conversation_participants"("user_id", "archived_at");

-- CreateIndex
CREATE INDEX "messages_reply_to_id_idx" ON "messages"("reply_to_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_seq_key" ON "messages"("conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sender_id_client_key_key" ON "messages"("sender_id", "client_key");

-- CreateIndex
CREATE INDEX "message_revisions_message_id_created_at_idx" ON "message_revisions"("message_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_storage_key_key" ON "message_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE INDEX "message_attachments_conversation_id_uploader_id_message_id_idx" ON "message_attachments"("conversation_id", "uploader_id", "message_id");

-- CreateIndex
CREATE INDEX "message_attachments_created_at_idx" ON "message_attachments"("created_at");

-- CreateIndex
CREATE INDEX "message_reactions_message_id_emoji_idx" ON "message_reactions"("message_id", "emoji");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_revisions" ADD CONSTRAINT "message_revisions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules Prisma cannot express ─────────────────────────────────

-- Exactly the context column matching the context type is set.
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_check" CHECK (
  ("context_type" = 'PROPERTY' AND "property_id" IS NOT NULL AND "booking_id" IS NULL)
  OR ("context_type" = 'BOOKING' AND "booking_id" IS NOT NULL AND "property_id" IS NULL)
);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_seq_check" CHECK ("last_seq" >= 0);
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_cursor_check"
  CHECK ("last_read_seq" >= 0 AND "last_notified_seq" >= 0);

-- System messages have no sender; every other message has one.
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_check" CHECK (("type" = 'SYSTEM') = ("sender_id" IS NULL));
ALTER TABLE "messages" ADD CONSTRAINT "messages_seq_check" CHECK ("seq" > 0);
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_bytes_check" CHECK ("bytes" > 0);

-- Unattached uploads are swept after a grace period.
CREATE INDEX "message_attachments_unattached_idx" ON "message_attachments" ("created_at") WHERE "message_id" IS NULL;

-- Messages and their edit history are never hard-deleted (deletion is a soft flag).
CREATE FUNCTION "forbid_message_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are kept for moderation and cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_no_delete" BEFORE DELETE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION "forbid_message_delete"();
CREATE TRIGGER "message_revisions_no_delete" BEFORE DELETE ON "message_revisions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_message_delete"();
