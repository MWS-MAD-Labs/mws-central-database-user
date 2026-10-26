-- CreateTable
CREATE TABLE "support_caseload_rules" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "max_students" INTEGER NOT NULL DEFAULT 2,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_caseload_rules_pkey" PRIMARY KEY ("id")
);
