import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "./http.js";

type RateLimitBucket = {
  timestamps: number[];
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  windowMs: number;
};

type RateLimiterOptions = {
  limit: number;
  name: string;
  windowMs: number;
};

const buckets = new Map<string, RateLimitBucket>();

function nowMs() {
  return Date.now();
}

function pruneBucket(bucket: RateLimitBucket, cutoff: number) {
  bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);
}

export function createRateLimiter(options: RateLimiterOptions) {
  return {
    check(key: string): RateLimitResult {
      const scopedKey = `${options.name}:${key}`;
      const currentTime = nowMs();
      const cutoff = currentTime - options.windowMs;
      const bucket = buckets.get(scopedKey) ?? { timestamps: [] };

      pruneBucket(bucket, cutoff);

      if (bucket.timestamps.length >= options.limit) {
        const oldestTimestamp = bucket.timestamps[0] ?? currentTime;
        return {
          allowed: false,
          limit: options.limit,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + options.windowMs - currentTime) / 1000)),
          windowMs: options.windowMs
        };
      }

      bucket.timestamps.push(currentTime);
      buckets.set(scopedKey, bucket);

      return {
        allowed: true,
        limit: options.limit,
        remaining: Math.max(options.limit - bucket.timestamps.length, 0),
        retryAfterSeconds: 0,
        windowMs: options.windowMs
      };
    },
    name: options.name
  };
}

export function getRateLimitIdentity(request: FastifyRequest) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() || request.ip;
  }

  return request.ip;
}

export function enforceRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  limiter: ReturnType<typeof createRateLimiter>,
  key: string,
  message: string
) {
  const result = limiter.check(key);

  if (result.allowed) {
    return false;
  }

  request.log.warn(
    {
      limit: result.limit,
      limiter: limiter.name,
      retryAfterSeconds: result.retryAfterSeconds,
      windowMs: result.windowMs
    },
    "Rate limit hit"
  );
  reply.header("Retry-After", String(result.retryAfterSeconds));
  sendError(reply, 429, "RATE_LIMITED", message, {
    retryAfterSeconds: result.retryAfterSeconds
  });
  return true;
}
