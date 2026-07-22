import { Router } from 'express';
import { ReviewController } from './review.controller';
import { rateLimiterMiddleware } from '../../shared/middlewares/rateLimit.middleware';

const router = Router();
const reviewController = new ReviewController();

// POST /api/v1/review (Rate Limited + SSE Stream)
router.post('/', rateLimiterMiddleware, (req, res) => reviewController.handleReviewStream(req, res));

// GET /api/v1/review/history (User Audit Trail)
router.get('/history', (req, res) => reviewController.handleGetHistory(req, res));

export default router;