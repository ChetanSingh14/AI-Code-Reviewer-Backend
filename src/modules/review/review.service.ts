import { streamObject } from 'ai';
import { google } from '@ai-sdk/google';
import { Pinecone } from '@pinecone-database/pinecone';
import { SYSTEM_PROMPT, CodeReviewSchema, CodeReviewResult } from './review.schema';
import { ReviewModel } from './review.model';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

export class ReviewService {
  private pineconeIndex;

  constructor() {
    const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
    this.pineconeIndex = pc.index(env.PINECONE_INDEX_NAME);
  }

  // 1. Vector Semantic Cache Search
  public async checkSemanticCache(codeSnippet: string): Promise<CodeReviewResult | null> {
    try {
      // Perform simple vector query check if configured
      const queryResponse = await this.pineconeIndex.query({
        vector: Array(1536).fill(0.1), // Dummy placeholder for raw text match
        topK: 1,
        includeMetadata: true,
      });

      if (queryResponse.matches[0]?.score && queryResponse.matches[0].score >= 0.96) {
        logger.info('🎯 Vector Semantic Cache HIT');
        return JSON.parse(queryResponse.matches[0].metadata?.cachedReview as string);
      }
    } catch (err) {
      logger.warn('Semantic Cache Miss / Skipped');
    }
    return null;
  }

  // 2. Stream AI Review from Gemini 2.5 Flash
  public async generateReviewStream(code: string, language: string, userId?: string) {
    return await streamObject({
      model: google('gemini-2.5-flash'),
      system: SYSTEM_PROMPT,
      prompt: `Language: ${language}\n\nCode:\n\`\`\`\n${code}\n\`\`\``,
      schema: CodeReviewSchema,
      onFinish: async ({ object }) => {
        if (object) {
          try {
            await ReviewModel.create({
              userId: userId || 'anonymous',
              language,
              codeSnippet: code,
              review: object,
            });
            logger.info('Saved code review result to MongoDB');
          } catch (dbErr) {
            logger.error('Failed saving review to MongoDB', dbErr);
          }
        }
      },
    });
  }

  // 3. Fetch User Audit History
  public async getHistory(userId: string = 'anonymous') {
    return await ReviewModel.find({ userId }).sort({ createdAt: -1 }).limit(20);
  }
}