/* Environment Config */

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5002),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().min(1).default("15m"),
  REFRESH_TOKEN_TTL: z.string().min(1).default("30d"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_CACHE_TTL: z.string().min(1).default("60s"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  // Uploads (docs/04-http-api.md). With the ImageKit keys set, photos and
  // videos go to ImageKit's CDN; without them they are written to UPLOAD_DIR
  // and served from /api/uploads, which is fine for development only.
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().url().optional(),
  UPLOAD_DIR: z.string().default("uploads"),
  // The development payment stand-in (POST /checkout/:id/simulate-payment).
  // On by default outside production and refused in production unless set,
  // because it marks an order paid without any money moving.
  PAYMENTS_SIMULATED: z.enum(["true", "false"]).optional(),
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error(`Invalid environment:\n${messages}\n\nCopy .env.example to .env and fill the values.`);
  process.exit(1);
}

const isProduction = parsed.data.NODE_ENV === "production";

/**
 * Whether the rate limiters actually count.
 *
 * Production only, and `RATE_LIMIT_ENABLED` still gets the final say — so it can
 * be turned off in production deliberately, or left on there when asked.
 *
 * Everywhere else the limiters are off by default because in development every
 * request arrives from `127.0.0.1`, which collapses the whole team onto one
 * bucket. A reload loop, a second laptop on the same checkout, or a script
 * hammering login then locks out *everyone* — including legitimate sign-in, with
 * no way for the person affected to tell that from an attack. The lockout is a
 * worse failure than the one the limiters prevent, and it is self-inflicted.
 *
 * Tests pass `enabled: true` per limiter instead of relying on this, so the
 * limiters are still exercised in CI where there is no shared IP to protect.
 */
const rateLimiting = parsed.data.RATE_LIMIT_ENABLED && isProduction;

export const env = {
  ...parsed.data,
  isProduction,
  isDevelopment: parsed.data.NODE_ENV === "development",
  rateLimiting,
};