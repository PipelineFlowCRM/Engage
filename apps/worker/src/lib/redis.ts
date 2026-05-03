import { Redis } from 'ioredis';
import { env } from '../env.js';
import { logger } from '../logger.js';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
redisConnection.on('error', (err: Error) => {
  logger.error({ err }, 'redis connection error');
});
