import { Request, Response, NextFunction } from 'express';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { env } from '../../config/env';
import { logger } from '../utils/logger';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// Sliding Window Rate Limiter: 5 requests per 1 minute window
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
});

export const rateLimiterMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const { success, limit, remaining, reset } = await ratelimit.limit(ip);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', reset);

    if (!success) {
      logger.warn(`Rate limit exceeded for IP: ${ip}`);
      res.status(429).json({ error: 'Rate limit exceeded. Maximum 5 scans allowed per minute.' });
      return;
    }

    next();
  } catch (error) {
    logger.error('Rate limiting middleware error', error);
    next(); // Fail-open so server stays operational if Redis degrades
  }
};