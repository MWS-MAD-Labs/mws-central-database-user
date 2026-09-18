import { bodyLimit } from "hono/body-limit";

// Reject oversized uploads before buffering, with room for multipart overhead.
export const photoUploadBodyLimit = bodyLimit({ maxSize: 20 * 1024 * 1024 });
export const attachmentUploadBodyLimit = bodyLimit({ maxSize: 10 * 1024 * 1024 });

// Keep the combined bulk limit below Nginx and Cloudflare ceilings.
export const bulkPhotoUploadBodyLimit = bodyLimit({ maxSize: 90 * 1024 * 1024 });
