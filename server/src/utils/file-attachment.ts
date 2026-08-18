import { ResponseError } from "../error/response-error";

export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Magic bytes, not the client-supplied Content-Type, which is trivially spoofable.
const FILE_SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

function detectFileMimeType(buffer: Buffer): string | null {
  const match = FILE_SIGNATURES.find((signature) =>
    signature.bytes.every((byte, index) => buffer[index] === byte),
  );
  return match?.mimeType ?? null;
}

// Returns the file's real mime type, detected from its content - not whatever
// Content-Type the client claimed.
export function assertValidAttachmentFile(buffer: Buffer): string {
  if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new ResponseError(
      400,
      `File is too large. Maximum size is ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB.`,
    );
  }

  const detectedMimeType = detectFileMimeType(buffer);
  if (!detectedMimeType) {
    throw new ResponseError(
      400,
      "Unsupported or unrecognized file type. Allowed types: PDF, JPEG, PNG.",
    );
  }

  return detectedMimeType;
}

// Strips path separators and anything outside a safe charset, so the
// original filename can't inject path segments into the MinIO object key.
export function sanitizeAttachmentFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return cleaned || "file";
}

// HTTP header values must stay ASCII-safe - this is display-only console
// context anyway, the DB relation is the actual source of truth.
export function sanitizeAttachmentMetadataValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "").slice(0, 100);
}

export async function streamToBuffer(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
