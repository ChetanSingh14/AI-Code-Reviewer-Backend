import { Request, Response } from 'express';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { SYSTEM_PROMPT, CodeReviewSchema } from '../review/review.schema';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

export class WebhookController {
  public async handleGitHubPRScan(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${env.GITHUB_ACTION_SECRET}`) {
        logger.warn('Unauthorized webhook scan attempt');
        res.status(401).json({ error: 'Unauthorized webhook payload source' });
        return;
      }

      const { codeDiff, prTitle } = req.body;
      if (!codeDiff) {
        res.status(400).json({ error: 'No code diff provided in payload' });
        return;
      }

      logger.info(`Received PR Security Webhook for PR: "${prTitle}"`);

      const { object: review } = await generateObject({
        model: google('gemini-2.5-flash'),
        system: SYSTEM_PROMPT,
        prompt: `PR Title: ${prTitle}\n\nCode Patch Diff:\n\`\`\`diff\n${codeDiff}\n\`\`\``,
        schema: CodeReviewSchema,
      });

      res.status(200).json(review);
    } catch (error) {
      logger.error('Webhook PR Scan Controller Error', error);
      res.status(500).json({ error: 'Internal server error during PR security scan' });
    }
  }
}