-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastTrialReminderOn" TEXT,
ADD COLUMN     "lastWinbackOn" TEXT,
ADD COLUMN     "winbackCount" INTEGER NOT NULL DEFAULT 0;
