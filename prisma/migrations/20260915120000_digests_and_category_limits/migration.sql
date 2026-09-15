-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "monthlyLimit" BIGINT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "eveningDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastEveningOn" TEXT,
ADD COLUMN     "lastMorningOn" TEXT,
ADD COLUMN     "lastWeeklyOn" TEXT,
ADD COLUMN     "morningDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weeklyDigest" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CategoryLimitAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryLimitAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryLimitAlert_categoryId_month_level_key" ON "CategoryLimitAlert"("categoryId", "month", "level");

-- AddForeignKey
ALTER TABLE "CategoryLimitAlert" ADD CONSTRAINT "CategoryLimitAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLimitAlert" ADD CONSTRAINT "CategoryLimitAlert_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

