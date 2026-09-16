-- AlterTable
ALTER TABLE "User" ADD COLUMN     "botOnboardingStep" TEXT,
ADD COLUMN     "botOnboardingData" JSONB,
ADD COLUMN     "firstCaptureCelebratedAt" TIMESTAMP(3);

-- У кого уже есть операции, первая запись давно позади — не поздравляем задним числом
UPDATE "User" SET "firstCaptureCelebratedAt" = NOW()
WHERE EXISTS (SELECT 1 FROM "Transaction" t WHERE t."userId" = "User"."id");
