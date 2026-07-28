import "dotenv/config";
import Redis from "ioredis";

export const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  // Fail fast instead of hanging requests when Redis is unreachable.
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
});
