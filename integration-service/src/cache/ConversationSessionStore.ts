import { ensureRedisConnection, redisClient } from './redisClient.js';

const CONVERSATION_SESSION_PREFIX = 'glpi_plugin_whatsapp:session:conversation:';

export class ConversationSessionStore {
  public async getSession(sessionId: string): Promise<string | null> {
    await ensureRedisConnection();

    return redisClient.get(`${CONVERSATION_SESSION_PREFIX}${sessionId}`);
  }

  public async setSession(sessionId: string, payload: string, ttlSeconds = 1800): Promise<void> {
    await ensureRedisConnection();

    await redisClient.set(`${CONVERSATION_SESSION_PREFIX}${sessionId}`, payload, 'EX', ttlSeconds);
  }
}
