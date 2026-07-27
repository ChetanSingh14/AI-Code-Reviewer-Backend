import { streamObject, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { Pinecone } from '@pinecone-database/pinecone';
import { SYSTEM_PROMPT, CodeReviewSchema, CodeReviewResult } from './review.schema';
import { ReviewModel } from './review.model';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

// Explicitly bind the Gemini API key from environment config
const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});

export class ReviewService {
  private pineconeIndex;

  constructor() {
    try {
      logger.info('Initializing Pinecone connection...');
      const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
      this.pineconeIndex = pc.index(env.PINECONE_INDEX_NAME);
      logger.info(`Pinecone connection initialized for index: ${env.PINECONE_INDEX_NAME}`);
    } catch (err) {
      logger.error('Pinecone initialization failed / connectivity issue:', err);
    }
  }

  // 1. Vector Semantic Cache Search
  public async checkSemanticCache(codeSnippet: string): Promise<CodeReviewResult | null> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        logger.warn('⚠️ Semantic Cache Query TIMEOUT (3000ms limit reached)');
        resolve(null);
      }, 3000);
    });

    const queryPromise = (async (): Promise<CodeReviewResult | null> => {
      try {
        logger.info('Generating embedding via google.textEmbeddingModel(gemini-embedding-001)...');
        const { embedding } = await embed({
          model: google.textEmbeddingModel('gemini-embedding-001'),
          value: codeSnippet,
          providerOptions: {
            google: {
              outputDimensionality: 1536,
            },
          },
        });
        logger.info(`Embedding generated successfully (dimension: ${embedding.length}). Querying Pinecone index...`);

        if (!this.pineconeIndex) {
          logger.error('Pinecone connection is not initialized. Skipping cache query.');
          return null;
        }

        const queryResponse = await this.pineconeIndex.query({
          vector: embedding,
          topK: 1,
          includeMetadata: true,
        });

        const match = queryResponse.matches[0];
        if (match && match.score && match.score >= 0.96 && match.metadata) {
          logger.info(`🎯 Vector Semantic Cache HIT. Match Score: ${match.score}`);
          return JSON.parse(match.metadata.cachedReview as string);
        }
        logger.info(`Semantic Cache Miss. Best match score: ${match?.score ?? 'none'}`);
      } catch (err) {
        logger.error('Semantic Cache Query failed / connectivity issue:', err);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
      return null;
    })();

    const result = await Promise.race([queryPromise, timeoutPromise]);
    if (result && timeoutId) {
      clearTimeout(timeoutId);
    }
    return result;
  }

  // 2. Stream AI Review from Gemini 2.5 Flash
  public async generateReviewStream(code: string, language: string, userId?: string) {
    logger.info(`Initializing Gemini stream review for language: ${language}, userId: ${userId || 'anonymous'}`);
    try {
      const stream = await streamObject({
        model: google('gemini-3.5-flash'), // Updated active model identifier
        system: SYSTEM_PROMPT,
        prompt: `Language: ${language}\n\nCode:\n\`\`\`\n${code}\n\`\`\``,
        schema: CodeReviewSchema,
        onFinish: async ({ object }) => {
          if (object) {
            try {
              // 1. Save to MongoDB
              await ReviewModel.create({
                userId: userId || 'anonymous',
                language,
                codeSnippet: code,
                review: object,
              });
              logger.info('Saved code review result to MongoDB successfully.');

              // 2. Generate embedding and UPSERT to Pinecone
              if (!this.pineconeIndex) {
                logger.error('Pinecone connection is not initialized. Skipping upsert.');
                return;
              }

              logger.info('Generating embedding for Pinecone upsert...');
              const { embedding } = await embed({
                model: google.textEmbeddingModel('gemini-embedding-001'),
                value: code,
                providerOptions: {
                  google: {
                    outputDimensionality: 1536,
                  },
                },
              });

              logger.info('Upserting review vector to Pinecone...');
              await this.pineconeIndex.upsert({
                records: [
                  {
                    id: `review-${Date.now()}`,
                    values: embedding,
                    metadata: {
                      language,
                      codeSnippet: code,
                      cachedReview: JSON.stringify(object),
                    },
                  },
                ]
              });
              logger.info('Successfully upserted review vector to Pinecone!');
            } catch (err) {
              logger.error('Failed saving audit payload / connection issue:', err);
            }
          }
        },
      });
      logger.info('Gemini stream review connection established successfully.');
      return stream;
    } catch (err) {
      logger.error('Gemini Stream Connection Error: Failed to initiate review stream', err);
      throw err;
    }
  }

  // 3. Fetch User Audit History
  public async getHistory(userId: string = 'anonymous') {
    return await ReviewModel.find({ userId }).sort({ createdAt: -1 }).limit(20);
  }
}