import { streamObject, generateObject, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { Pinecone } from '@pinecone-database/pinecone';
import { CodeReviewSchema, CodeReviewResult, AgentReviewSchema } from './review.schema';
import { SECURITY_AGENT_PROMPT, PERFORMANCE_AGENT_PROMPT, SYNTHESIZER_AGENT_PROMPT, CONSOLIDATED_REVIEWER_PROMPT } from './review.prompts';
import { ReviewModel } from './review.model';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';
import { analyzeAST } from '../../shared/utils/astAnalyzer';

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

      // Seed repository rules from rules.md on startup
      this.seedRules();
    } catch (err) {
      logger.error('Pinecone initialization failed / connectivity issue:', err);
    }
  }

  // Seed repository rules from rules.md into Pinecone
  private async seedRules() {
    try {
      if (!this.pineconeIndex) return;

      // Check if rules are already seeded to avoid duplicates
      logger.info('Checking if repository rules are seeded in Pinecone...');
      try {
        const checkResponse = await this.pineconeIndex.fetch({ ids: ['rule-0'] });
        if (checkResponse.records && checkResponse.records['rule-0']) {
          logger.info('Repository rules are already seeded in Pinecone. Skipping seeding.');
          return;
        }
      } catch (checkErr) {
        // Fetch failed or rule-0 doesn't exist, proceed to seeding
      }

      logger.info('Seeding repository rules into Pinecone...');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      
      const filePath = path.join(process.cwd(), 'rules.md');
      const content = await fs.readFile(filePath, 'utf-8');

      // Split rule text by "- RULE:" chunks
      const ruleBlocks = content
        .split('- RULE:')
        .map(r => r.trim())
        .filter(r => r.length > 0);

      for (let i = 0; i < ruleBlocks.length; i++) {
        const ruleText = `- RULE: ${ruleBlocks[i]}`;
        
        // Generate embedding
        const { embedding } = await embed({
          model: google.textEmbeddingModel('gemini-embedding-001'),
          value: ruleText,
          providerOptions: {
            google: {
              outputDimensionality: 1536,
            },
          },
        });

        // Upsert to Pinecone
        await this.pineconeIndex.upsert({
          records: [
            {
              id: `rule-${i}`,
              values: embedding,
              metadata: {
                type: 'rule',
                ruleText,
              },
            },
          ]
        });
      }
      logger.info('Successfully seeded repository rules into Pinecone!');
    } catch (err) {
      logger.error('Failed to seed rules in Pinecone:', err);
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
          filter: { type: { $ne: 'rule' } },
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
      // 0. Run local AST rule-based analysis
      logger.info('Running local AST static analysis pre-scan...');
      const astIssues = analyzeAST(code, language);
      logger.info(`AST pre-scan completed. Found ${astIssues.length} issues.`);

      // 0.5. Run RAG search for repository rules matching the code snippet
      let matchedRules: string[] = [];
      if (this.pineconeIndex) {
        try {
          logger.info('Running RAG search for repository rules...');
          const { embedding } = await embed({
            model: google.textEmbeddingModel('gemini-embedding-001'),
            value: code,
            providerOptions: {
              google: {
                outputDimensionality: 1536,
              },
            },
          });

          const rulesResponse = await this.pineconeIndex.query({
            vector: embedding,
            topK: 3,
            filter: { type: 'rule' },
            includeMetadata: true,
          });

          if (rulesResponse.matches) {
            matchedRules = rulesResponse.matches
              .filter((m) => m.score && m.score >= 0.5 && m.metadata)
              .map((m) => m.metadata!.ruleText as string);
            logger.info(`RAG rule search retrieved ${matchedRules.length} matching guidelines.`);
          }
        } catch (err) {
          logger.error('RAG rules query failed:', err);
        }
      }

      logger.info('Invoking consolidated Multi-Agent streaming reviewer...');

      // 2. Stream AI Review from Consolidating Orchestrator Agent
      const stream = await streamObject({
        model: google('gemini-3.5-flash'),
        system: CONSOLIDATED_REVIEWER_PROMPT,
        prompt: `Original Code to Audit:
\`\`\`${language}
${code}
\`\`\`

---
Repository Guidelines to Enforce (RAG matched):
${matchedRules.length > 0 ? matchedRules.join('\n') : 'No matching custom repo guidelines found.'}

---
Local AST Static Rules Findings (Verify and integrate where appropriate):
${JSON.stringify(astIssues, null, 2)}`,
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
                      type: 'review',
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