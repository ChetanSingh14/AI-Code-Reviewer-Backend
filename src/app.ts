import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';

// Import Middlewares & Routes
import reviewRoutes from './modules/review/review.routes';
import webhookRoutes from './modules/webhook/webhook.routes';
import { errorHandler } from './shared/middlewares/error.middleware';

const app: Application = express();

// Global Middlewares
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Mount Feature Modules
app.use('/api/v1/review', reviewRoutes);
app.use('/api/v1/webhook', webhookRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'AI Code Reviewer Backend',
    timestamp: new Date().toISOString(),
  });
});

// Centralized Error Handler
app.use(errorHandler);

export default app;