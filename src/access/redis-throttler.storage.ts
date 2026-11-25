import { Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { createClient } from 'redis';

const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private client?: ReturnType<typeof createClient>;
  private connection?: Promise<unknown>;

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, _name: string) {
    if (!process.env.REDIS_URL) throw new ServiceUnavailableException('Redis não configurado');
    try {
      if (!this.client) {
        this.client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } });
        this.client.on('error', () => this.logger.error('Conexão com Redis indisponível'));
      }
      if (!this.client.isOpen) {
        this.connection ??= this.client.connect().finally(() => { this.connection = undefined; });
        await this.connection;
      }
      const result = await this.client.eval(SCRIPT, { keys: [`api-sports:rate:${key}`], arguments: [String(ttl)] }) as [number, number];
      const remaining = Math.max(1, Math.ceil(result[1] / 1000));
      return { totalHits: result[0], timeToExpire: remaining, isBlocked: result[0] > limit, timeToBlockExpire: remaining };
    } catch {
      throw new ServiceUnavailableException('Rate limit indisponível');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }
}
