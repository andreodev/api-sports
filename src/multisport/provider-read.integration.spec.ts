import { EventsService } from './events.service.js';

const testUrl = process.env.REDIS_TEST_URL;
const safe = (() => {
  if (!testUrl) return false;
  try { const url = new URL(testUrl); return ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/15'; }
  catch { return false; }
})();

describe.skipIf(!safe)('provider relay with isolated Redis', () => {
  it('shares the background budget and reserves capacity for a status check', async () => {
    const previousRedis = process.env.REDIS_URL;
    const previousKey = process.env.API_SPORTS_KEY;
    process.env.REDIS_URL = testUrl;
    process.env.API_SPORTS_KEY = 'provider-test-key';
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ errors: [], response: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const service = new EventsService();
    try {
      for (let i = 0; i < 6; i++) await service.providerRead('football', 'fixtures', { date: `2026-11-${String(i + 1).padStart(2, '0')}` });
      await expect(service.providerRead('football', 'fixtures', { date: '2026-11-07' })).rejects.toThrow();
      await expect(service.providerRead('football', 'status', {})).resolves.toMatchObject({ body: { response: [] } });
      expect(fetchMock).toHaveBeenCalledTimes(7);
    } finally {
      await service.onApplicationShutdown();
      vi.unstubAllGlobals();
      if (previousRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedis;
      if (previousKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = previousKey;
    }
  });
});
