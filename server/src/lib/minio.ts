import "dotenv/config";
import { Client } from "minio";

export const MINIO_BUCKET = process.env.MINIO_BUCKET || "mws-data-center";

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "",
  secretKey: process.env.MINIO_SECRET_KEY || "",
  region: process.env.MINIO_REGION || "us-east-1",
});

// Presigned URLs are handed to the browser, so they must be signed against a
// host it can actually resolve - the internal Docker service name above
// works for server-to-minio calls but not for a client outside the network.
// Falls back to the internal client's own settings when no public endpoint
// is configured (local dev, where there's no distinction).
const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;
export const minioPresignClient = publicEndpoint
  ? new Client({
      endPoint: publicEndpoint,
      port: process.env.MINIO_PUBLIC_PORT
        ? Number(process.env.MINIO_PUBLIC_PORT)
        : undefined,
      useSSL: process.env.MINIO_PUBLIC_USE_SSL !== "false",
      accessKey: process.env.MINIO_ACCESS_KEY || "",
      secretKey: process.env.MINIO_SECRET_KEY || "",
      region: process.env.MINIO_REGION || "us-east-1",
    })
  : minioClient;

export async function ensureBucketExists(): Promise<void> {
  const exists = await minioClient.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET);
  }
}
