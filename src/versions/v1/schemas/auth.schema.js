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