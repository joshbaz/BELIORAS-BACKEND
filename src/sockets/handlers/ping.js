/* Socket Ping */

export function registerPing(socket) {
  socket.on("ping", (callback) => {
    if (typeof callback === "function") callback({ pong: Date.now() });
  });
}