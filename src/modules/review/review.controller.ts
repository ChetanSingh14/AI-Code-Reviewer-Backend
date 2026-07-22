import { Request, Response } from 'express';
import { ReviewService } from './review.service';

const reviewService = new ReviewService();

export class ReviewController {
  public async handleReviewStream(req: Request, res: Response): Promise<void> {
    try {
      const { code, language, userId } = req.body;

      if (!code) {
        res.status(400).json({ error: 'Code snippet is required' });
        return;
      }

      // Check Semantic Vector Cache first
      const cachedResult = await reviewService.checkSemanticCache(code);
      if (cachedResult) {
        res.setHeader('X-Cache-Hit', 'true');
        res.status(200).json(cachedResult);
        return;
      }

      // Generate Live Stream from AI
      const streamResult = await reviewService.generateReviewStream(
        code,
        language || 'javascript',
        userId
      );

      // Pipe Server-Sent Events (SSE) to HTTP Response
      streamResult.pipeTextStreamToResponse(res);
    } catch (error) {
      console.error('Review Stream Controller Error:', error);
      res.status(500).json({ error: 'Internal Server Error during review streaming' });
    }
  }

  public async handleGetHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.query.userId as string) || 'anonymous';
      const history = await reviewService.getHistory(userId);
      res.status(200).json(history);
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve review history' });
    }
  }
}