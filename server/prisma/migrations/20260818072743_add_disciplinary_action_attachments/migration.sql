/*
  Warnings:

  - You are about to drop the column `document_url` on the `employee_disciplinary_actions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "employee_disciplinary_actions" DROP COLUMN "document_url";

-- CreateTable
CREATE TABLE "disciplinary_action_attachments" (
    "id" TEXT NOT NULL,
    "disciplinary_action_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "disciplinary_action_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disciplinary_action_attachments_object_key_key" ON "disciplinary_action_attachments"("object_key");

-- AddForeignKey
ALTER TABLE "disciplinary_action_attachments" ADD CONSTRAINT "disciplinary_action_attachments_disciplinary_action_id_fkey" FOREIGN KEY ("disciplinary_action_id") REFERENCES "employee_disciplinary_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
