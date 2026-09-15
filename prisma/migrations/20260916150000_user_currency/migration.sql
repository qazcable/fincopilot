-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KZT',
ADD COLUMN     "secondaryCurrency" TEXT DEFAULT 'USD';

