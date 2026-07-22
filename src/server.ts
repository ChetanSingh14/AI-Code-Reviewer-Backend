import { env } from "node:process";
import app from "./app";
import { connectDB } from "./config/db";
import { logger } from "./shared/utils/logger";


const startServer = async () => {
  // 1. Initialize DB Connection
  await connectDB();

  // 2. Start Express Listener
  app.listen(env.PORT, () => {
    logger.info(`🚀 Server initialized in ${env.NODE_ENV} mode on http://localhost:${env.PORT}`);
  });
};

startServer();