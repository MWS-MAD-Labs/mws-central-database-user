-- CreateTable
CREATE TABLE "master_institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_majors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_majors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_institutions_name_key" ON "master_institutions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "master_majors_name_key" ON "master_majors"("name");
