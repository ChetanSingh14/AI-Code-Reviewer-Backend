import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MongoDB URI is required'),
  GEMINI_API_KEY: z.string().min(1, 'Gemini API Key is required'),
  UPSTASH_REDIS_REST_URL: z.string().min(1, 'Upstash Redis URL is required'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'Upstash Redis Token is required'),
  PINECONE_API_KEY: z.string().min(1, 'Pinecone API Key is required'),
  PINECONE_INDEX_NAME: z.string().default('code-reviews'),
  GITHUB_ACTION_SECRET: z.string().min(1, 'GitHub Action Secret is required'),
});

export const env = envSchema.parse(process.env);