/* Newsletter And Contact Service */

import { randomBytes } from "node:crypto";
import newsletterSeed from "./newsletter.seed.json" with { type: "json" };
import subscribersSeed from "./subscribers.seed.json" with { type: "json" };
import campaignsSeed from "./campaigns.seed.json" with { type: "json" };
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { env } from "../../config/index.js";
import { audit } from "../audit/audit.js";
import { queueEmail } from "../emails/emails.service.js";
import { getStoreSettings } from "../settings/settings.service.js";

/**
 * The Belioras Letter — its audience, campaigns and welcome email — and the
 * contact form. Same rules the browser applied, now in one place:
 *
 *   - joining is double opt-in, and each record keeps when, where and to what
 *     wording consent was given;
 *   - the welcome code is sent once per address, on first confirmation, so
 *     leaving and rejoining does not earn a second one;
 *   - unsubscribing never deletes the record; erasure does;
 *   - a sent campaign is never edited.
 *
 * Nothing here sends email: it is queued in the outbox, and goes out when a
 * mail provider is connected.
 */

const { rev: _rev, ...NEWSLETTER_SEED } = newsletterSeed;
export const SEED_SUBSCRIBERS = subscribersSeed;
export const SEED_CAMPAIGNS = campaignsSeed;

/** A confirmation link opened twice in quick succession still reads as fresh. */
const FRESH_MS = 10 * 60 * 1000;
const token = () => randomBytes(16).toString("hex");
const iso = (d) => (d ? new Date(d).toISOString() : null);

/* ------------------------------------------------------------- Settings -- */

export async function getNewsletterSettings() {
  const row = await prisma.setting.findUnique({ where: { id: "newsletter" } });
  if (row) return row.value;
  await prisma.setting.upsert({ where: { id: "newsletter" }, create: { id: "newsletter", value: NEWSLETTER_SEED }, update: {} });
  return NEWSLETTER_SEED;
}

export async function updateWelcomeEmail(input, actor, meta = {}) {
  const welcome = {
    enabled: Boolean(input.enabled),
    couponCode: input.couponCode || null,
    subject: (input.subject ?? "").trim(),
    heading: (input.heading ?? "").trim(),
    body: (input.body ?? "").trim(),
  };
  if (welcome.enabled && (!welcome.subject || !welcome.heading || !welcome.body)) {
    throw new ApiError("Give the welcome email a subject, heading and message, or turn it off.", 422);
  }
  if (welcome.couponCode) {
    const coupon = await prisma.coupon.findFirst({ where: { code: { equals: welcome.couponCode, mode: "insensitive" }, active: true } });
    if (!coupon) throw new ApiError("That code is not an active coupon.", 422);
  }
  const value = { ...(await getNewsletterSettings()), welcome };
  await prisma.setting.update({ where: { id: "newsletter" }, data: { value } });
  await audit(actor.id, "staff", "NEWSLETTER_UPDATE", { ...meta, meta: { welcome: welcome.enabled } });
  return welcome;
}

/* ----------------------------------------------------------- Subscribers -- */

function presentSubscriber(s) {
  return { ...s, consentedAt: iso(s.consentedAt), confirmedAt: iso(s.confirmedAt), unsubscribedAt: iso(s.unsubscribedAt), welcomeSentAt: iso(s.welcomeSentAt) };
}

/** Starts, or restarts, a sign-up. Ends pending unless the address is already subscribed. */
export async function subscribe({ email, name = null, source = "footer" }, customer = null) {
  const value = email.trim().toLowerCase();
  const existing = await prisma.subscriber.findUnique({ where: { email: value } });
  if (existing?.status === "subscribed") return { status: "subscribed", email: value };

  const { consentText } = await getNewsletterSettings();
  const fields = { status: "pending", source, consentText, consentedAt: new Date(), confirmedAt: null, unsubscribedAt: null, token: token() };
  if (existing) {
    await prisma.subscriber.update({ where: { id: existing.id }, data: { ...fields, name: existing.name ?? name, userId: existing.userId ?? customer?.id ?? null } });
  } else {
    await prisma.subscriber.create({ data: { id: `sub_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, email: value, name, userId: customer?.id ?? null, ...fields } });
  }
  await queueEmail(prisma, { type: "newsletter-confirm", to: value, subject: "Confirm your subscription to the Belioras Letter", data: { token: fields.token } });
  // The token is the confirmation link's secret. It goes by email; outside
  // production it is also returned, so the flow can be tried without a mailbox.
  return { status: "pending", email: value, ...(env.NODE_ENV !== "production" ? { token: fields.token } : {}) };
}

/** The confirmation link. Subscribes the address and, the first time, issues the welcome code. */
export async function confirmSubscription(linkToken) {
  const record = await prisma.subscriber.findUnique({ where: { token: linkToken } });
  if (!record) throw new ApiError("This link has expired, or a newer one has replaced it.", 404);
  if (record.status === "unsubscribed" || record.status === "bounced") {
    throw new ApiError("This link is no longer active. Sign up again to rejoin the Letter.", 410);
  }
  if (record.status === "subscribed") {
    const fresh = Date.now() - (record.confirmedAt?.getTime() ?? 0) < FRESH_MS;
    const sentNow = fresh && record.welcomeSentAt?.getTime() === record.confirmedAt?.getTime();
    return { email: record.email, welcomeCode: sentNow ? record.welcomeCode : null, already: !fresh };
  }
  const { welcome } = await getNewsletterSettings();
  const code = record.welcomeSentAt ? null : welcome?.enabled ? welcome.couponCode : null;
  const at = new Date();
  await prisma.subscriber.update({
    where: { id: record.id },
    data: { status: "subscribed", confirmedAt: at, ...(code ? { welcomeCode: code, welcomeSentAt: at } : {}) },
  });
  if (welcome?.enabled) {
    await queueEmail(prisma, { type: "newsletter-welcome", to: record.email, subject: welcome.subject || "Welcome to the Belioras Letter", data: { couponCode: code } });
  }
  return { email: record.email, welcomeCode: code, already: false };
}

/** The link in every email. */
export async function unsubscribe(linkToken) {
  const record = await prisma.subscriber.findUnique({ where: { token: linkToken } });
  if (!record) throw new ApiError("We could not find that subscription. It may already have been removed.", 404);
  if (record.status !== "unsubscribed") {
    await prisma.subscriber.update({ where: { id: record.id }, data: { status: "unsubscribed", unsubscribedAt: new Date() } });
  }
  return { email: record.email };
}

/** A signed-in shopper's own subscription. */
export async function getMySubscription(email) {
  const record = await prisma.subscriber.findUnique({ where: { email: email.toLowerCase() } });
  if (!record) return null;
  return {
    status: record.status,
    confirmedAt: iso(record.confirmedAt),
    token: record.status === "pending" && env.NODE_ENV !== "production" ? record.token : null,
  };
}

export async function unsubscribeMe(email) {
  const record = await prisma.subscriber.findUnique({ where: { email: email.toLowerCase() } });
  if (record && record.status !== "unsubscribed") {
    await prisma.subscriber.update({ where: { id: record.id }, data: { status: "unsubscribed", unsubscribedAt: new Date() } });
  }
  return { email };
}

export async function listSubscribers() {
  return (await prisma.subscriber.findMany({ orderBy: { consentedAt: "desc" } })).map(presentSubscriber);
}

export async function unsubscribeSubscriber(id, actor, meta = {}) {
  const record = await prisma.subscriber.findUnique({ where: { id } });
  if (!record) throw new ApiError("That subscriber no longer exists.", 404);
  const updated = await prisma.subscriber.update({ where: { id }, data: { status: "unsubscribed", unsubscribedAt: new Date() } });
  await audit(actor.id, "staff", "SUBSCRIBER_UNSUBSCRIBE", { ...meta, meta: { id } });
  return presentSubscriber(updated);
}

/** A GDPR erasure: the address and its consent record are deleted entirely. */
export async function eraseSubscriber(id, actor, meta = {}) {
  const record = await prisma.subscriber.findUnique({ where: { id } });
  if (!record) throw new ApiError("That subscriber no longer exists.", 404);
  await prisma.subscriber.delete({ where: { id } });
  // The log says an erasure happened, never whose address it was.
  await audit(actor.id, "staff", "SUBSCRIBER_ERASE", { ...meta, meta: { id } });
  return presentSubscriber(record);
}

export const audienceSize = () => prisma.subscriber.count({ where: { status: "subscribed" } });

/* ------------------------------------------------------------- Campaigns -- */

function presentCampaign(c) {
  return { ...c, sendAt: iso(c.sendAt), sentAt: iso(c.sentAt), createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) };
}

async function editable(id) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError("That campaign no longer exists.", 404);
  if (campaign.status === "sent") throw new ApiError("A sent campaign can't be changed: it is the record of what subscribers received.", 409);
  return campaign;
}

function assertReady(c) {
  if (!c.heading) throw new ApiError("Add a heading before sending.", 422);
  if (!c.body) throw new ApiError("Write the message before sending.", 422);
}

export async function listCampaigns() {
  const rows = await prisma.campaign.findMany();
  const when = (c) => (c.sentAt ?? c.sendAt ?? c.updatedAt).getTime();
  return rows.sort((a, b) => when(b) - when(a)).map(presentCampaign);
}

export async function saveCampaign(input, actor, meta = {}) {
  const fields = {
    subject: input.subject.trim(),
    previewText: (input.previewText ?? "").trim(),
    heading: (input.heading ?? "").trim(),
    body: (input.body ?? "").trim(),
    productIds: (input.productIds ?? []).slice(0, 4),
    cta: { label: (input.cta?.label ?? "").trim(), url: input.cta?.url || "/shop" },
  };
  const saved = input.id
    ? await prisma.campaign.update({ where: { id: (await editable(input.id)).id }, data: fields })
    : await prisma.campaign.create({ data: { id: `cmp_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, ...fields, status: "draft" } });
  await audit(actor.id, "staff", "CAMPAIGN_SAVE", { ...meta, meta: { id: saved.id } });
  return presentCampaign(saved);
}

export async function scheduleCampaign(id, sendAt, actor, meta = {}) {
  const campaign = await editable(id);
  assertReady(campaign);
  const time = Date.parse(sendAt ?? "");
  if (Number.isNaN(time) || time <= Date.now()) throw new ApiError("Choose a date and time in the future.", 422);
  const saved = await prisma.campaign.update({ where: { id }, data: { status: "scheduled", sendAt: new Date(time) } });
  await audit(actor.id, "staff", "CAMPAIGN_SAVE", { ...meta, meta: { id, scheduled: iso(time) } });
  return presentCampaign(saved);
}

export async function unscheduleCampaign(id) {
  await editable(id);
  return presentCampaign(await prisma.campaign.update({ where: { id }, data: { status: "draft", sendAt: null } }));
}

/** One email per confirmed subscriber, each with its own unsubscribe link. */
export async function sendCampaign(id, actor = null, meta = {}) {
  const campaign = await editable(id);
  assertReady(campaign);
  const audience = await prisma.subscriber.findMany({ where: { status: "subscribed" }, select: { email: true, token: true } });
  if (!audience.length) throw new ApiError("There are no confirmed subscribers to send to yet.", 422);
  // Claim the send first, so a scheduled send and a manual one cannot both go.
  const { count } = await prisma.campaign.updateMany({
    where: { id, status: { not: "sent" } },
    data: { status: "sent", sentAt: new Date(), sendAt: null, recipients: audience.length },
  });
  if (!count) throw new ApiError("This campaign has already been sent.", 409);
  for (const s of audience) {
    await queueEmail(prisma, { type: "campaign", to: s.email, subject: campaign.subject, data: { campaignId: id, unsubscribeToken: s.token } });
  }
  if (actor) await audit(actor.id, "staff", "CAMPAIGN_SEND", { ...meta, meta: { id, recipients: audience.length } });
  return presentCampaign(await prisma.campaign.findUnique({ where: { id } }));
}

/** Sends scheduled campaigns that are due. Run by the server's once-a-minute sweep. */
export async function sendDueCampaigns() {
  const due = await prisma.campaign.findMany({ where: { status: "scheduled", sendAt: { lte: new Date() } }, select: { id: true } });
  const sent = [];
  for (const { id } of due) {
    try {
      await sendCampaign(id);
      sent.push(id);
    } catch {
      // Nobody to send to yet, or sent meanwhile: it stays as it is.
    }
  }
  return sent;
}

export async function deleteCampaign(id, actor, meta = {}) {
  const campaign = await editable(id);
  await prisma.campaign.delete({ where: { id } });
  await audit(actor.id, "staff", "CAMPAIGN_DELETE", { ...meta, meta: { id } });
  return presentCampaign(campaign);
}

/* --------------------------------------------------------------- Contact -- */

/** Keeps the message and queues it to client care, with the shopper's address to reply to. */
export async function sendContactMessage({ name, email, subject, message }) {
  const entry = await prisma.contactMessage.create({
    data: { name: name.trim(), email: email.trim().toLowerCase(), subject: subject?.trim() || "General", message: message.trim() },
  });
  const settings = await getStoreSettings();
  await queueEmail(prisma, {
    type: "contact-received",
    to: settings.contact?.support ?? "support@belioras.com",
    subject: `Contact form: ${entry.subject} — ${entry.name}`,
    data: { replyTo: entry.email, message: entry.message },
  });
  return { status: "queued", entry: { ...entry, receivedAt: entry.createdAt.toISOString() } };
}

export async function listContactMessages() {
  const rows = await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((m) => ({ ...m, receivedAt: m.createdAt.toISOString() }));
}

/* ------------------------------------------------------------------ Seed -- */

export function seedSubscriber(s) {
  const d = (v) => (v ? new Date(v) : null);
  return {
    id: s.id, email: s.email.toLowerCase(), name: s.name ?? null, userId: s.userId ?? null, status: s.status, source: s.source ?? "import",
    consentText: s.consentText ?? NEWSLETTER_SEED.consentText, consentedAt: d(s.consentedAt) ?? new Date(), confirmedAt: d(s.confirmedAt),
    unsubscribedAt: d(s.unsubscribedAt), token: s.token ?? token(), welcomeCode: s.welcomeCode ?? null, welcomeSentAt: d(s.welcomeSentAt),
  };
}

export function seedCampaign(c) {
  const d = (v) => (v ? new Date(v) : null);
  return {
    id: c.id, subject: c.subject, previewText: c.previewText ?? "", heading: c.heading ?? "", body: c.body ?? "",
    productIds: c.productIds ?? [], cta: c.cta ?? { label: "", url: "/shop" }, status: c.status, sendAt: d(c.sendAt),
    sentAt: d(c.sentAt), recipients: c.recipients ?? null, createdAt: d(c.createdAt) ?? new Date(),
  };
}
