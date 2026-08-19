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

// Bulk photo commit/preview carry every selected file in one multipart
// request - each file still gets its own 15MB check further down
// (student/employee-photo-service.ts), this only guards the combined total.
// Set just under nginx's client_max_body_size (client/nginx.conf, 95m,
// itself capped by Cloudflare's fixed 100MB Free/Pro plan limit) so an
// oversized batch gets a clean JSON 413 from here instead of nginx's raw
// HTML error page - or, in practice, instead of a raw Cloudflare 413 page
// for anything that would've exceeded nginx's own tighter cap too.
export const bulkPhotoUploadBodyLimit = bodyLimit({ maxSize: 90 * 1024 * 1024 });
