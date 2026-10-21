-- CreateTable
CREATE TABLE "children_allowance_rules" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "max_children" INTEGER,
    "age_limit" INTEGER NOT NULL DEFAULT 23,
    "count_biological" BOOLEAN NOT NULL DEFAULT true,
    "count_adopted" BOOLEAN NOT NULL DEFAULT true,
    "count_step" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "children_allowance_rules_pkey" PRIMARY KEY ("id")
);
