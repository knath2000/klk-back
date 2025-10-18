-- Drop existing foreign key constraints
ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "conversation_messages_conversation_id_fkey";
ALTER TABLE "conversation_models" DROP CONSTRAINT IF EXISTS "conversation_models_conversation_id_fkey";
ALTER TABLE "shared_conversations" DROP CONSTRAINT IF EXISTS "shared_conversations_conversation_id_fkey";
ALTER TABLE "conversation_analytics" DROP CONSTRAINT IF EXISTS "conversation_analytics_conversation_id_fkey";

-- Recreate constraints with ON DELETE CASCADE
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;

ALTER TABLE "conversation_models"
  ADD CONSTRAINT "conversation_models_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;

ALTER TABLE "shared_conversations"
  ADD CONSTRAINT "shared_conversations_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;

ALTER TABLE "conversation_analytics"
  ADD CONSTRAINT "conversation_analytics_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;