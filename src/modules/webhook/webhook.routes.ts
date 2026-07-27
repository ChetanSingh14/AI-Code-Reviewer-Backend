import { Router } from 'express';
import { WebhookController } from './webhook.controller';

const router = Router();
const webhookController = new WebhookController();

// POST /api/v1/webhook/github-pr
router.post('/github-pr', (req, res) => webhookController.handleGitHubPRScan(req, res));

// POST /api/v1/webhook/github-app
router.post('/github-app', (req, res) => webhookController.handleGitHubAppWebhook(req, res));

export default router;