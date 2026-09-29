import { randomUUID } from "crypto";
import { MINIO_BUCKET, ensureBucketExists, minioClient } from "../lib/minio";
import { detectImageMimeType, processPhoto } from "../utils/image-processing";
import { logger } from "../lib/logger";

async function removeObjectIfExists(objectKey: string | null): Promise<void> {
  if (!objectKey) return;
  await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
}

// Downloads the admin's current Google avatar once and caches it in MinIO,
// the same object-storage pattern Employee/Student photos already use -
// the browser never hot-links googleusercontent.com directly, which is
// what was hitting Google's rate limit on every profile page load.
//
// Skips the download entirely when the Google URL hasn't changed since
// last login and an object is already cached - this is the actual fix for
// the rate limit, not just a proxy: an unchanged photo re-uploads nothing.
export async function cacheGoogleAvatar(
  adminId: string,
  googleAvatarUrl: string | null | undefined,
  previousUrl: string | null,
  previousObjectKey: string | null,
): Promise<{ avatarUrl: string | null; objectKey: string | null }> {
  if (!googleAvatarUrl) {
    return { avatarUrl: null, objectKey: null };
  }
  if (googleAvatarUrl === previousUrl && previousObjectKey) {
    return { avatarUrl: googleAvatarUrl, objectKey: previousObjectKey };
  }

  try {
    const fetched = await fetch(googleAvatarUrl);
    if (!fetched.ok) {
      throw new Error(`Google avatar fetch failed with ${fetched.status}`);
    }
    const rawBuffer = Buffer.from(await fetched.arrayBuffer());
    if (!detectImageMimeType(rawBuffer)) {
      throw new Error("Google avatar response was not a recognizable image");
    }
    const processedBuffer = await processPhoto(rawBuffer);
    const objectKey = `admin-avatars/${adminId}/${randomUUID()}.avif`;

    await ensureBucketExists();
    await minioClient.putObject(
      MINIO_BUCKET,
      objectKey,
      processedBuffer,
      processedBuffer.length,
      { "Content-Type": "image/avif" },
    );

    // Only after the new object is safely uploaded - avoids leaving the
    // admin avatarless if something above failed.
    await removeObjectIfExists(previousObjectKey);

    return { avatarUrl: googleAvatarUrl, objectKey };
  } catch (error) {
    // A caching failure shouldn't block login - fall back to the raw
    // Google URL for this session, same as before this feature existed.
    logger.error("Failed to cache Google avatar, falling back to the raw URL", {
      error,
      adminId,
    });
    return { avatarUrl: googleAvatarUrl, objectKey: previousObjectKey };
  }
}
