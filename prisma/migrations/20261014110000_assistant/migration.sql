-- "Ask HavenHub" assistant: questions asked, for support staff to review.

-- CreateTable
CREATE TABLE "assistant_questions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "text" VARCHAR(500) NOT NULL,
    "intent" VARCHAR(30) NOT NULL,
    "answered" BOOLEAN NOT NULL,
    "handed_off" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_questions_created_at_idx" ON "assistant_questions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_questions_answered_created_at_idx" ON "assistant_questions"("answered", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "assistant_questions" ADD CONSTRAINT "assistant_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
