/* Auth Validation Schemas */

import { z } from "zod";

const email = z.email("Enter a valid email address.").trim().toLowerCase();
const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120).optional(),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password,
});

export const preferencesSchema = z.object({
  preferences: z.record(z.unknown()).default({}),
});

/**
 * Creating a staff account. The temporary password is the admin's to choose —
 * they are handing it over out of band, so the server's job is only to refuse
 * something too weak to survive that channel, which is what the shared
 * `password` rule above already does.
 */
export const staffCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(120),
  email,
  role: z.string().trim().min(1, "Choose a role.").max(60),
  password,
});

export const staffRoleSchema = z.object({
  role: z.string().trim().min(1, "Choose a role.").max(60),
});

/**
 * Suspending or restoring an account. The two values are named in full rather
 * than as a boolean, because a boolean on a route like this is a coin toss:
 * `false` has to mean "restore" and a reader cannot tell that from "do nothing".
 *
 * Written as a string plus a predicate rather than `z.enum` because Zod 4 reports
 * a rejected enum member as "Invalid option: expected one of …", which tells the
 * caller what went wrong and not what to send instead.
 */
export const staffStatusSchema = z.object({
  status: z
    .string()
    .refine((value) => value === "active" || value === "suspended", {
      message: "Send \"suspended\" to remove access, or \"active\" to give it back.",
    }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: password,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "Choose a password you haven't used here before.",
    path: ["newPassword"],
  });