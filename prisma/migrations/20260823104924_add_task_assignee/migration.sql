-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_organizationId_fkey" FOREIGN KEY ("assigneeId", "organizationId") REFERENCES "memberships"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
