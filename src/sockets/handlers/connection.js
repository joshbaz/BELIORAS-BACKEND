/* Socket Connection */

import { ROOM_PUBLIC, ROOM_STAFF, roomUser } from "../rooms.js";
import { registerPing } from "./ping.js";

export function registerConnection(io) {
  io.on("connection", (socket) => {
    // Every socket joins the public broadcast room by default.
    socket.join(ROOM_PUBLIC);

    if (socket.user) {
      // Authenticated sockets also join their realm room and private user room.
      socket.join(roomUser(socket.user.id));

      if (socket.user.realm === "staff") {
        socket.join(ROOM_STAFF);
      }
    }

    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    socket.emit("connected", { socketId: socket.id, rooms });

    registerPing(socket);
  });
}