/* Socket Io Setup */

import { Server } from "socket.io";
import { env } from "../config/env.js";
import { checkSession } from "../features/auth/guards.js";
import { registerConnection } from "./handlers/connection.js";

let io;

export function initSocket(server) {
  io = new Server(server, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use(authenticateSocket);
  registerConnection(io);
  return io;
}

/**
 * Optional auth: a valid access token in the handshake `auth.token` attaches
 * `socket.user`; anonymous connections are still allowed (storefront live data
 * needs no sign-in). Reuses the same `checkSession` guard as HTTP, including
 * the session cache and `tokenVersion` re-check.
 */
async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next();

  try {
    const user = await checkSession(token);
    socket.user = { id: user.id, realm: user.realm };
    next();
  } catch {
    next(new Error("unauthorized"));
  }
}

export function getIo() {
  return io;
}