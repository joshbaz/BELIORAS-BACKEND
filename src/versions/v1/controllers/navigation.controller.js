/* Navigation Controller */

import * as navigation from "../../../features/navigation/navigation.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/** Reading and saving the mega menu. No business logic here — that is the service's job. */

export async function getNavigation(req, res) {
  res.json({ data: await navigation.getNavigation() });
}

/** The storefront's read: every page's header and footer. Short cache so a save shows within a minute. */
export async function getPublicNavigation(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await navigation.getNavigation() });
}

export async function updateNavigation(req, res) {
  res.json({ data: await navigation.updateNavigation(req.body, req.user, requestMeta(req)) });
}

export async function resetNavigation(req, res) {
  res.json({ data: await navigation.resetNavigation(req.user, requestMeta(req)) });
}
