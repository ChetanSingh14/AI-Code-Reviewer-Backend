import app from './src/app';
import { connectDB } from './src/config/db';
import { env } from './src/config/env';
import { logger } from './src/shared/utils/logger';

const startServer = async () => {
  // 1. Initialize DB Connection
  await connectDB();

  // 2. Start Express Listener
  app.listen(env.PORT, () => {
    logger.info(`🚀 Server initialized in ${env.NODE_ENV} mode on http://localhost:${env.PORT}`);
  });
};

startServer();