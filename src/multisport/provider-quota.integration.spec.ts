import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { PROVIDER_QUOTA } from './events.service.js';

describe.skipIf(!process.env.REDIS_TEST_URL)('shared provider quota', () => {
  it('admits at most ten concurrent calls in a rolling minute across clients', async () => {
    const url = new URL(process.env.REDIS_TEST_URL!); url.pathname = '/9';
    const first = createClient({ url: url.toString() }), second = createClient({ url: url.toString() });
    await Promise.all([first.connect(), second.connect()]);
    const key = `api-sports:test:quota:${randomUUID()}`;
    const backgroundKey = `${key}:background`;
    const dailyKey = `${key}:daily`;
    const admit = (client: typeof first, priority = 'interactive', dailyLimit = '0') => client.eval(PROVIDER_QUOTA, { keys: [key, backgroundKey, dailyKey], arguments: [randomUUID(), priority, dailyLimit] });
    try {
      const attempts = await Promise.all(Array.from({ length: 25 }, (_, index) => admit(index % 2 ? first : second)));
      expect(attempts.filter((value) => value === 1)).toHaveLength(10);
      expect(attempts.filter((value) => value === 0)).toHaveLength(15);
      expect(await first.zCard(key)).toBe(10);
      await first.zAdd(key, [{ score: 0, value: 'expired' }]);
      expect(await admit(second)).toBe(0);
      expect(await first.zScore(key, 'expired')).toBeNull();
      await first.zRemRangeByScore(key, '-inf', '+inf');
      expect(await admit(second)).toBe(1);
      await first.del([key, backgroundKey]);
      const background = await Promise.all(Array.from({ length: 10 }, () => admit(first, 'background')));
      expect(background.filter((value) => value === 1)).toHaveLength(6);
      const interactive = await Promise.all(Array.from({ length: 5 }, () => admit(second)));
      expect(interactive.filter((value) => value === 1)).toHaveLength(4);
      await first.del([key, backgroundKey, dailyKey]);
      const dailyBackground = await Promise.all(Array.from({ length: 5 }, () => admit(first, 'background', '5')));
      expect(dailyBackground.filter((value) => value === 1)).toHaveLength(4);
      expect(await admit(second, 'interactive', '5')).toBe(1);
      expect(await admit(second, 'interactive', '5')).toBe(0);
      expect(await first.ttl(dailyKey)).toBeGreaterThan(0);
      await first.del([key, backgroundKey, dailyKey]);
      const custom = await Promise.all(Array.from({ length: 20 }, () => first.eval(PROVIDER_QUOTA, { keys: [key, backgroundKey, dailyKey], arguments: [randomUUID(), 'background', '0', '20', '15'] })));
      expect(custom.filter((value) => value === 1)).toHaveLength(15);
      const reserved = await Promise.all(Array.from({ length: 6 }, () => first.eval(PROVIDER_QUOTA, { keys: [key, backgroundKey, dailyKey], arguments: [randomUUID(), 'interactive', '0', '20', '15'] })));
      expect(reserved.filter((value) => value === 1)).toHaveLength(5);
    } finally { await first.del([key, backgroundKey, dailyKey]); await Promise.all([first.close(), second.close()]); }
  });
});
