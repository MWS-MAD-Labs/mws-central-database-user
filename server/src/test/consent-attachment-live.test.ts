import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  ConsentTest,
  ConsentAttachmentTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { MINIO_BUCKET, minioClient } from "../lib/minio";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

async function isMinioReachable(): Promise<boolean> {
  try {
    await minioClient.listBuckets();
    return true;
  } catch {
    return false;
  }
}

const minioAvailable = await isMinioReachable();
if (!minioAvailable) {
  logger.warn(
    "MinIO not reachable at MINIO_ENDPOINT:MINIO_PORT - skipping consent-attachment-live.test.ts. Run `docker compose up -d minio` to enable it.",
  );
}

// Real upload/download round-trip against a live MinIO instance. Skipped
// entirely when MinIO isn't reachable, so `bun test` stays safe without it.
describe.skipIf(!minioAvailable)("Consent Attachment (live MinIO)", () => {
  let studentId: string;
  let consentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await ConsentAttachmentTest.delete();
    await ConsentTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_consent_attachment_live@millennia21.id",
      nis: "9400002",
    });
    studentId = student.student!.id;

    const consent = await ConsentTest.create({ studentId });
    consentId = consent.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should upload a PDF and download back the exact same bytes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const originalBytes = new TextEncoder().encode(
      "%PDF-1.4\nTest consent letter content",
    );

    const formData = new FormData();
    formData.append(
      "file",
      new File([originalBytes], "surat izin ortu.pdf", {
        type: "application/pdf",
      }),
    );

    const uploadResponse = await TestRequest.postMultipart(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
      formData,
      accessToken,
    );
    const uploadBody = await uploadResponse.json();
    logger.debug(uploadBody);

    expect(uploadResponse.status).toBe(200);
    expect(uploadBody.data.mime_type).toBe("application/pdf");
    // Spaces sanitized, extension preserved.
    expect(uploadBody.data.file_name).toBe("surat_izin_ortu.pdf");

    const downloadResponse = await TestRequest.get(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments/${uploadBody.data.id}/download`,
      accessToken,
    );
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe(
      "application/pdf",
    );

    const downloadedBytes = new Uint8Array(await downloadResponse.arrayBuffer());
    expect(downloadedBytes).toEqual(originalBytes);
  });

  it("should store the object in the bucket at the recorded object_key", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\nAnother letter");
    const formData = new FormData();
    formData.append(
      "file",
      new File([pdfBytes], "letter.pdf", { type: "application/pdf" }),
    );

    const uploadResponse = await TestRequest.postMultipart(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
      formData,
      accessToken,
    );
    const uploadBody = await uploadResponse.json();
    const attachment = await prismaClient.consentAttachment.findUniqueOrThrow(
      { where: { id: uploadBody.data.id } },
    );

    const stat = await minioClient.statObject(
      MINIO_BUCKET,
      attachment.object_key,
    );
    expect(stat.size).toBe(pdfBytes.length);
    // Console-visible context, doesn't affect the object key itself.
    expect(stat.metaData["student-nis"]).toBe("9400002");
    expect(stat.metaData["student-name"]).toBe("Test Student");
  });

  it("should keep the object in MinIO after a soft-delete (only the DB row is marked deleted)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\nDelete me maybe");
    const formData = new FormData();
    formData.append(
      "file",
      new File([pdfBytes], "letter.pdf", { type: "application/pdf" }),
    );

    const uploadResponse = await TestRequest.postMultipart(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
      formData,
      accessToken,
    );
    const uploadBody = await uploadResponse.json();
    const attachment = await prismaClient.consentAttachment.findUniqueOrThrow(
      { where: { id: uploadBody.data.id } },
    );

    const deleteResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments/delete/${uploadBody.data.id}`,
      {},
      accessToken,
    );
    expect(deleteResponse.status).toBe(200);

    // Soft-delete only flips deleted_at - the file itself must still be recoverable.
    const stat = await minioClient.statObject(
      MINIO_BUCKET,
      attachment.object_key,
    );
    expect(stat.size).toBe(pdfBytes.length);
  });
});
