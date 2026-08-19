import { bodyLimit } from "hono/body-limit";

// Rejects an oversized upload outright (413, using Content-Length when
// present) before the request body is even fully read - a much cheaper
// failure than buffering the whole thing into memory just to have the
// endpoint's own size check (employee/student-photo-service.ts,
// file-attachment.ts) reject it afterward. Set a bit above each endpoint's
// real limit (15MB photos, 5MB attachments) for multipart overhead margin -
// not applied globally since bulk-commit endpoints and imports intentionally
// carry much larger payloads.
export const photoUploadBodyLimit = bodyLimit({ maxSize: 20 * 1024 * 1024 });
export const attachmentUploadBodyLimit = bodyLimit({ maxSize: 10 * 1024 * 1024 });
