/* Upload Service */

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../core/ApiError.js";
import { env } from "../../config/index.js";
import { logger } from "../../core/logger.js";

/**
 * Where photos and videos go, behind one function so the store can change
 * without touching a caller.
 *
 *   - ImageKit, when `IMAGEKIT_PRIVATE_KEY` and `IMAGEKIT_URL_ENDPOINT` are
 *     set: files land on its CDN, and the storefront asks it for the size it
 *     needs (`?tr=w-400`). The private key never leaves this server.
 *   - Local disk otherwise (`UPLOAD_DIR`, served at `/api/uploads`), so uploads
 *     work in development without an account. Not for production: files live
 *     on one machine and are served by Node.
 *
 * What a file *is* is decided from its first bytes, never from its name or
 * the browser's claimed type, so a renamed script cannot be stored as a photo.
 */

export const LIMITS = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

/** The public path local uploads are served from. */
export const LOCAL_PATH = "/api/uploads";

const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, at, text) => buf.subarray(at, at + text.length).toString("latin1") === text;

/** `{ kind, ext, mime }` from the file's signature, or null. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: "image", ext: "jpg", mime: "image/jpeg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", ext: "png", mime: "image/png" };
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WEBP")) return { kind: "image", ext: "webp", mime: "image/webp" };
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", ext: "webm", mime: "video/webm" };
  if (ascii(buf, 4, "ftyp")) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return { kind: "image", ext: "avif", mime: "image/avif" };
    if (brand === "qt  ") return { kind: "video", ext: "mov", mime: "video/quicktime" };
    return { kind: "video", ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

export function storageMode() {
  return env.IMAGEKIT_PRIVATE_KEY && env.IMAGEKIT_URL_ENDPOINT ? "imagekit" : "local";
}

function fileName(ext) {
  return `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${ext}`;
}

async function toImageKit(buffer, type, folder) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: type.mime }), fileName(type.ext));
  form.append("fileName", fileName(type.ext));
  form.append("folder", `/belioras/${folder}`);
  form.append("useUniqueFileName", "true");

  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.url) {
    logger.error({ status: res.status, body }, "ImageKit upload failed");
    throw new ApiError("The photo could not be stored. Try again in a moment.", 502);
  }
  return { url: body.url, width: body.width ?? null, height: body.height ?? null };
}

async function toDisk(buffer, type) {
  const dir = path.resolve(env.UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  const name = fileName(type.ext);
  await writeFile(path.join(dir, name), buffer);
  return { url: `${LOCAL_PATH}/${name}`, width: null, height: null };
}

/**
 * Stores one file and returns `{ url, kind, mime, size, width, height }`.
 * `folder` groups files on ImageKit: products, menu, models, home.
 */
export async function storeUpload(file, { folder = "products" } = {}) {
  if (!file?.buffer?.length) throw new ApiError("Choose a file to upload.", 400);
  const type = sniff(file.buffer);
  if (!type) throw new ApiError("That file isn't a JPEG, PNG, WebP or AVIF photo, or an MP4, MOV or WebM video.", 415);
  if (file.buffer.length > LIMITS[type.kind]) {
    throw new ApiError(type.kind === "image" ? "Photos can be up to 10 MB." : "Videos can be up to 100 MB.", 413);
  }
  const stored = storageMode() === "imagekit" ? await toImageKit(file.buffer, type, folder) : await toDisk(file.buffer, type);
  return { ...stored, kind: type.kind, mime: type.mime, size: file.buffer.length };
}
