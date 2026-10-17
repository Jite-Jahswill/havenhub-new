-- Direct customer → agent conversations: the AGENT context links an agent
-- profile and nothing else; every other context has no agent profile.
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_context_check";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_check" CHECK (
  ("context_type" = 'PROPERTY' AND "property_id" IS NOT NULL AND "booking_id" IS NULL AND "experience_id" IS NULL AND "agent_profile_id" IS NULL)
  OR ("context_type" = 'BOOKING' AND "booking_id" IS NOT NULL AND "property_id" IS NULL AND "experience_id" IS NULL AND "agent_profile_id" IS NULL)
  OR ("context_type" = 'EXPERIENCE' AND "experience_id" IS NOT NULL AND "property_id" IS NULL AND "booking_id" IS NULL AND "agent_profile_id" IS NULL)
  OR ("context_type" = 'SUPPORT' AND "property_id" IS NULL AND "booking_id" IS NULL AND "experience_id" IS NULL AND "agent_profile_id" IS NULL)
  OR ("context_type" = 'AGENT' AND "agent_profile_id" IS NOT NULL AND "property_id" IS NULL AND "booking_id" IS NULL AND "experience_id" IS NULL)
);
