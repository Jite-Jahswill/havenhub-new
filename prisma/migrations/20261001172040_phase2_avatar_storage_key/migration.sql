-- Store the avatar's storage key instead of a URL (URLs are derived at read time).
-- Rename rather than drop+add so no existing data can be lost.
ALTER TABLE "users" RENAME COLUMN "avatar_url" TO "avatar_key";
ALTER TABLE "users" ALTER COLUMN "avatar_key" TYPE VARCHAR(300);
