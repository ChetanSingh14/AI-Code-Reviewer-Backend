import { env } from "node:process";
import { createServer } from "node:http";
import { Server } from "socket.io";
import app from "./app";
import { connectDB } from "./config/db";
import { logger } from "./shared/utils/logger";
import { initializeReviewSocket } from "./modules/review/review.socket";

const startServer = async () => {
  // 1. Initialize DB Connection
  await connectDB();

  // 2. Create HTTP Server and bind Socket.io
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // 3. Initialize WebSocket Event Listeners
  initializeReviewSocket(io);

  // 4. Start HTTP Server Listener
  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 Server initialized in ${env.NODE_ENV} mode on http://localhost:${env.PORT}`);
  });
};

startServer();