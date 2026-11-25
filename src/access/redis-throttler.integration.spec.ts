import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe.skipIf(!process.env.REDIS_TEST_URL)('Redis throttler integration', () => {
  it('shares limits across instances and isolates consumers', async () => {
    const previous = process.env.REDIS_URL;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    const first = new RedisThrottlerStorage();
    const second = new RedisThrottlerStorage();
    const consumer = randomUUID();
    try {
      expect((await first.increment(consumer, 10_000, 2, 10_000, 'default')).isBlocked).toBe(false);
      expect((await second.increment(consumer, 10_000, 2, 10_000, 'default')).isBlocked).toBe(false);
      expect((await first.increment(consumer, 10_000, 2, 10_000, 'default')).isBlocked).toBe(true);
      expect((await second.increment(randomUUID(), 10_000, 2, 10_000, 'default')).isBlocked).toBe(false);
    } finally {
      await first.onApplicationShutdown();
      await second.onApplicationShutdown();
      if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous;
    }
  });
});
