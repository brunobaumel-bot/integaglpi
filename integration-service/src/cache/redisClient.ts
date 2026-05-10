import { once } from 'node:events';

import { Redis } from 'ioredis';

import { env } from '../config/env.js';

export const redisClient = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

export async function ensureRedisConnection(): Promise<void> {
  if (redisClient.status === 'ready') {
    return;
  }

  if (redisClient.status === 'connecting') {
    await once(redisClient, 'ready');
    return;
  }

  await redisClient.connect();
}
