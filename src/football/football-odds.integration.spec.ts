import { createClient } from 'redis';
import { EventsService } from '../multisport/events.service.js';

describe.skipIf(!process.env.REDIS_TEST_URL)('football provider failures', () => {
  it('handles 429, missing markets and provider failures without enabling betting', async () => {
    const oldRedis = process.env.REDIS_URL, oldKey = process.env.API_SPORTS_KEY, oldBook = process.env.FOOTBALL_BOOKMAKER_ID;
    const url = new URL(process.env.REDIS_TEST_URL!); url.pathname = '/14';
    process.env.REDIS_URL = url.toString(); process.env.API_SPORTS_KEY = 'integration-test-key'; process.env.FOOTBALL_BOOKMAKER_ID = '8';
    const redis = createClient({ url: url.toString() }); await redis.connect();
    const keys = ['api-sports:provider:minute:rolling', 'api-sports:provider:cooldown', 'api-sports:football:prematch:v1:8:987601', 'api-sports:football:prematch:v1:8:987602', 'api-sports:football:prematch:v1:8:987603', 'api-sports:provider:daily-exhausted:football', 'api-sports:provider:minute-exhausted:football', 'api-sports:provider:minute:background'];
    await redis.del(keys);
    const service = new EventsService();
    const mock = vi.fn(); vi.stubGlobal('fetch', mock);
    const response = (id: number) => ({ response: [{ fixture: { id, date: '2099-01-01T00:00:00Z', status: { short: 'NS' } } }], errors: [], paging: { current: 1, total: 1 } });
    try {
      mock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '12' } }));
      await expect(service.footballOdds('987601')).rejects.toMatchObject({ status: 503 });
      expect(await redis.ttl('api-sports:provider:cooldown')).toBeGreaterThan(0);
      await expect(service.footballOdds('987601')).rejects.toMatchObject({ status: 503 });
      expect(mock).toHaveBeenCalledTimes(1);
      await redis.del('api-sports:provider:cooldown');
      mock.mockResolvedValueOnce(new Response(JSON.stringify(response(987602)))).mockResolvedValueOnce(new Response(JSON.stringify({ response: [], errors: [], paging: { current: 1, total: 1 } })));
      await expect(service.footballOdds('987602')).resolves.toMatchObject({ fixtureId: '987602', selections: [], bettable: false, reason: 'ODDS_UNAVAILABLE' });
      mock.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
      await expect(service.footballOdds('987603')).rejects.toMatchObject({ status: 502 });
      expect(await redis.get(keys[4])).toBeNull();
      mock.mockResolvedValueOnce(new Response(JSON.stringify(response(987604)), { headers: { 'x-ratelimit-requests-remaining': '0' } }));
      await expect(service.footballOdds('987604')).rejects.toMatchObject({ status: 503 });
      expect(await redis.get('api-sports:provider:daily-exhausted:football')).toBe('1');
      await expect(service.footballOdds('987605')).rejects.toMatchObject({ status: 503 });
      await redis.del('api-sports:provider:daily-exhausted:football');
      mock.mockResolvedValueOnce(new Response(JSON.stringify(response(987606)), { headers: { 'x-ratelimit-remaining': '0' } }));
      await expect(service.footballOdds('987606')).rejects.toMatchObject({ status: 503 });
      expect(await redis.ttl('api-sports:provider:minute-exhausted:football')).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals(); await service.onApplicationShutdown(); await redis.del(keys); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
      if (oldBook === undefined) delete process.env.FOOTBALL_BOOKMAKER_ID; else process.env.FOOTBALL_BOOKMAKER_ID = oldBook;
    }
  });
});
