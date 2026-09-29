/* Seed Admin — repeatable first Administrator */

/**
 * Creates (or tops up) the shop's first Administrator so there is something to
 * sign in with, on an environment where the one-time bootstrap at
 * `POST /admin/auth/register` has already been spent.
 *
 * Idempotent: re-running resets the password and the role rather than failing,
 * which is what makes it usable to recover a locked-out admin. It refuses
 * outright if any other staff account exists — that environment should be
 * managed through the dashboard, not by a script that would happily overwrite
 * a real person's access.
 *
 * A reset is a *revocation event*, not just a new password: it bumps
 * `tokenVersion` and drops the admin's sessions and cached session, so a password
 * recovered on a suspected-compromise machine cannot be worked around with a
 * token stolen before the reset.
 *
 * `SEED_ADMIN_PASSWORD` is required — this file is public, so it has no default
 * password of its own to publish.
 *
 *   SEED_ADMIN_PASSWORD=... yarn seed:admin
 *   SEED_ADMIN_EMAIL=you@belioras.com SEED_ADMIN_PASSWORD=... yarn seed:admin
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { ROLES } from "../src/features/auth/roles.js";
import { del as delSessionCache } from "../src/features/auth/sessionCache.js";

const SALT_ROUNDS = 10;

const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@belioras.com").trim().toLowerCase();
const name = process.env.SEED_ADMIN_NAME ?? "Belioras Administrator";
// No default. This file is in the repository, so any default written here is a
// published credential for a super-admin — the only thing between it and a
// deployed shop is someone reading this line. Required instead, on every
// environment: a value typed by the person running the script is one the
// repository never held.
const password = process.env.SEED_ADMIN_PASSWORD ?? "";

if (password.length < 8) {
  console.error("SEED_ADMIN_PASSWORD must be set and at least 8 characters.");
  process.exit(1);
}

const others = await prisma.user.findMany({
  where: { realm: "staff" },
  select: { id: true, email: true, role: true },
});
const existing = others.find((u) => u.email === email);

if (others.length && !existing) {
  console.error(
    `Refusing to seed: ${others.length} staff account(s) already exist and none is ${email}.\n` +
      "Manage staff through the dashboard instead, or point SEED_ADMIN_EMAIL at the existing admin.",
  );
  await prisma.$disconnect();
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

let revoked = 0;
let user;

if (existing) {
  // `increment` rather than a fixed 0: setting the counter back to zero would
  // re-accept access tokens minted before the reset, which is the one thing a
  // password recovery must not do.
  user = await prisma.user.update({
    where: { id: existing.id },
    data: { name, passwordHash, role: ROLES.SUPER_ADMIN, tokenVersion: { increment: 1 } },
  });
  const dropped = await prisma.session.deleteMany({ where: { userId: existing.id } });
  revoked = dropped.count;
  await delSessionCache(existing.id);
} else {
  user = await prisma.user.create({
    data: { realm: "staff", email, name, passwordHash, role: ROLES.SUPER_ADMIN, tokenVersion: 0 },
  });
}

console.log(
  `${existing ? "Reset" : "Created"} ${ROLES.SUPER_ADMIN}: ${user.email}\n` +
    (revoked
      ? `Revoked ${revoked} session(s); every existing access token for this account is now invalid.\n`
      : "") +
    `Sign in at /atelier with that email and the password you supplied.`,
);

await prisma.$disconnect();
// The session cache opened a Redis connection, which would otherwise hold the
// event loop open and leave this script hanging after it has done its work.
await redis.quit().catch(() => {});
