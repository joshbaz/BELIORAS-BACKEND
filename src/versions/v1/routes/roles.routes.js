/* Role Routes */

import { Router } from "express";
import { z } from "zod";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import * as roles from "../../../features/roles/roles.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/**
 * Team → Roles. Every member of staff can read the roles — they are what draws
 * each person's dashboard — and those with "edit" on Team change them, within
 * the limits the service enforces.
 */

const roleSchema = z
  .object({
    name: z.string().trim().min(1, "Give the role a name.").max(60),
    description: z.string().max(300).optional(),
    permissions: z.record(z.string().max(40), z.enum(["none", "view", "edit"])),
  })
  .strict();

const router = Router();
const staffIn = [authenticate, requireBoundary];
const mayEdit = requireAccess("team:edit");

router.get("/roles", ...staffIn, async (req, res) => res.json({ data: await roles.listRoles() }));
router.post("/roles", ...staffIn, mayEdit, validate(roleSchema), async (req, res) => {
  res.status(201).json({ data: await roles.createRole(req.body, req.user, requestMeta(req)) });
});
router.patch("/roles/:id", ...staffIn, mayEdit, validate(roleSchema), async (req, res) => {
  res.json({ data: await roles.updateRole(req.params.id, req.body, req.user, requestMeta(req)) });
});
router.delete("/roles/:id", ...staffIn, mayEdit, async (req, res) => {
  res.json({ data: await roles.deleteRole(req.params.id, req.user, requestMeta(req)) });
});

export default router;
