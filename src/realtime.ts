import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { RuntimeConfig } from "./config.js";

export function attachRealtimeServer(server: HttpServer, config: RuntimeConfig): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.corsOrigin,
      credentials: true
    },
    path: "/socket.io"
  });

  const realtime = io.of("/realtime");

  realtime.on("connection", (socket) => {
    socket.emit("connection.ready", {
      connectedAt: new Date().toISOString(),
      socketId: socket.id
    });

    socket.on("disconnect", (reason) => {
      socket.emit("connection.closed", {
        reason
      });
    });
  });

  return io;
}
