import { Router } from 'express';
import { WebhookController } from './webhook.controller';

const router = Router();
const webhookController = new WebhookController();

// POST /api/v1/webhook/github-pr
router.post('/github-pr', (req, res) => webhookController.handleGitHubPRScan(req, res));

export default router;