/* Test Helpers */

import assert from "node:assert/strict";
import "dotenv/config";

// The auth endpoints are hammered in these tests; keep the shared app's
// limiters off so tests never trip on 429s. The rate-limit test builds its own
// limiter with `enabled: true`.
process.env.RATE_LIMIT_ENABLED = "false";

// Integration tests must never touch development data. Point Prisma and Redis
// at dedicated test instances before anything imports them. The bootstrap test
// (first-staff registration) depends on the staff table starting empty, which
// is only true against a fresh test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "mongodb://localhost:27017/belioras_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";
process.env.SESSION_CACHE_TTL = process.env.SESSION_CACHE_TTL ?? "60s";
// Uploads in tests go to local disk, never to the real ImageKit library, even
// when the developer's .env carries ImageKit keys.
process.env.IMAGEKIT_PRIVATE_KEY = "";
process.env.UPLOAD_DIR = process.env.TEST_UPLOAD_DIR ?? "uploads-test";

import request from "supertest";

let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = import("../src/app.js").then(({ createApp }) => createApp());
  }
  return appPromise;
}

/** supertest bound to the app; call with full paths, e.g. request.post("/api/v1/auth/login"). */
export async function api() {
  const app = await getApp();
  return request(app);
}

export function uniqueEmail(prefix = "test") {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Pulls the raw refresh cookie (name, value, attributes) for a realm. */
export function refreshCookie(res, realm = "customer") {
  const cookies = res.headers["set-cookie"] ?? [];
  const found = cookies.find((cookie) => cookie.startsWith(`belioras_refresh_${realm}=`));
  assert(found, `expected a ${realm} refresh cookie, got: ${cookies.join(", ") || "none"}`);
  return found;
}

/** The cookie directive part only, e.g. `belioras_refresh_customer=<token>`. */
export function cookieDirective(cookie) {
  return cookie.split(";")[0];
}

export async function teardown() {
  const { prisma } = await import("../src/db/prisma.js");
  const { redis } = await import("../src/db/redis.js");
  await prisma.$disconnect();
  redis.disconnect();
}