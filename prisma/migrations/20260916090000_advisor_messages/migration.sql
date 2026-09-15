-- CreateTable
CREATE TABLE "AdvisorMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvisorMessage_userId_createdAt_idx" ON "AdvisorMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdvisorMessage" ADD CONSTRAINT "AdvisorMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

