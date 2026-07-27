import { Request, Response } from 'express';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { App } from 'octokit';
import crypto from 'node:crypto';
import { SYSTEM_PROMPT, CodeReviewSchema } from '../review/review.schema';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

// Explicitly bind the Gemini API key from environment config
const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});

export class WebhookController {
  // Existing GitHub Actions webhook scan
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
        model: google('gemini-3.5-flash'),
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

  // GitHub App Webhook Integration (Inline Comments)
  public async handleGitHubAppWebhook(req: Request, res: Response): Promise<void> {
    try {
      // 1. Verify Webhook Signature (if webhook secret is set)
      const signature = req.headers['x-hub-signature-256'] as string;
      if (env.GITHUB_APP_WEBHOOK_SECRET && signature) {
        const payloadStr = JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha256', env.GITHUB_APP_WEBHOOK_SECRET);
        const digest = 'sha256=' + hmac.update(payloadStr).digest('hex');
        if (signature !== digest) {
          logger.warn('Invalid GitHub App webhook signature');
          res.status(401).json({ error: 'Invalid webhook signature' });
          return;
        }
      }

      const event = req.headers['x-github-event'] as string;
      logger.info(`Received GitHub App Webhook event: "${event}"`);

      if (event === 'pull_request') {
        const { action, pull_request, repository, installation } = req.body;
        if (action === 'opened' || action === 'synchronize') {
          const owner = repository.owner.login;
          const repo = repository.name;
          const prNumber = pull_request.number;
          const installationId = installation.id;

          logger.info(`PR ${action} event: ${owner}/${repo}#${prNumber}`);

          // Trigger async background review process
          this.processGitHubPRReview(owner, repo, prNumber, installationId).catch((err) => {
            logger.error(`Error processing background PR review for ${owner}/${repo}#${prNumber}:`, err);
          });

          res.status(202).json({ message: 'GitHub App PR review initiated' });
          return;
        }
      }

      res.status(200).json({ message: 'Event acknowledged' });
    } catch (error) {
      logger.error('GitHub App Webhook Controller Error:', error);
      res.status(500).json({ error: 'Internal server error during webhook processing' });
    }
  }

  // Background PR review processor
  private async processGitHubPRReview(
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number
  ): Promise<void> {
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      logger.error('GitHub App ID or Private Key is not configured. Skipping PR review.');
      return;
    }

    try {
      // 1. Authenticate GitHub App
      const app = new App({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), // format key correctly
      });

      const octokit = await app.getInstallationOctokit(installationId);

      // 2. Fetch the PR Diff text
      logger.info(`Fetching diff for PR ${owner}/${repo}#${prNumber}...`);
      const { data: diff } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: prNumber,
        headers: {
          accept: 'application/vnd.github.v3.diff',
        },
      });

      if (!diff || typeof diff !== 'string') {
        logger.error(`No diff text found for PR ${owner}/${repo}#${prNumber}`);
        return;
      }

      // 3. Generate structured code review using Gemini
      logger.info(`Running AI review scan on PR diff...`);
      const systemInstructions = `${SYSTEM_PROMPT}
You are analyzing a Pull Request Code Diff.
Your output issues list MUST map findings back to their respective file path (filePath field) and line number (line field) as identified in the diff additions (lines starting with +).
Ensure the line numbers represent the target file line number, not the diff line number.`;

      const { object: review } = await generateObject({
        model: google('gemini-3.5-flash'),
        system: systemInstructions,
        prompt: `Review the following GitHub PR diff and identify issues:\n\n\`\`\`diff\n${diff}\n\`\`\``,
        schema: CodeReviewSchema,
      });

      const { issues, summary, score, hasCriticalVulnerability } = review;
      logger.info(`Gemini review completed for PR. Found ${issues.length} issues.`);

      // 4. Map issues to inline GitHub PR review comments
      const comments = issues
        .filter((issue) => issue.filePath && issue.line)
        .map((issue) => ({
          path: issue.filePath!,
          line: issue.line!,
          side: 'RIGHT' as const,
          body: `### 🤖 AI Review - ${issue.severity}
**${issue.title}**

${issue.description}

**Suggestion:**
\`\`\`
${issue.suggestion}
\`\`\``,
        }));

      // 5. Submit Pull Request Review
      logger.info(`Submitting pull request review with ${comments.length} inline comments...`);
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: 'COMMENT',
        body: `### 🤖 AI Code Review Summary
${summary}

**Overall Quality Score:** ${score}/100
**Critical Vulnerabilities Found:** ${hasCriticalVulnerability ? '⚠️ Yes' : '✅ No'}`,
        comments,
      });
      logger.info(`Successfully posted Pull Request review for ${owner}/${repo}#${prNumber}!`);
    } catch (error) {
      logger.error(`Error processing PR review for ${owner}/${repo}#${prNumber}:`, error);
    }
  }
}