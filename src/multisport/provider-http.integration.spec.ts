import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessModule } from '../access/access.module.js';
import { EventsService } from './events.service.js';
import { ProviderController } from './provider.controller.js';

const redisUrl = process.env.REDIS_TEST_URL;
const safe = (() => {
  if (!redisUrl) return false;
  try { const parsed = new URL(redisUrl); return ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/14'; }
  catch { return false; }
})();

describe.skipIf(!safe)('authenticated provider HTTP contract', () => {
  it('authenticates the consumer and relays football and basketball to fixed hosts', async () => {
    const old = { redis: process.env.REDIS_URL, clients: process.env.API_CLIENTS, key: process.env.API_SPORTS_KEY };
    process.env.REDIS_URL = redisUrl;
    process.env.API_CLIENTS = JSON.stringify({ test: 'c'.repeat(40) });
    process.env.API_SPORTS_KEY = 'provider-key';
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ errors: [], response: [], paging: { current: 1, total: 1 } }), { headers: { 'x-ratelimit-remaining': '99' } }));
    vi.stubGlobal('fetch', fetchMock);
    const module = await Test.createTestingModule({ imports: [AccessModule], controllers: [ProviderController], providers: [EventsService] }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/v1/provider/football/fixtures?date=2026-11-25').expect(401);
      const football = await request(app.getHttpServer()).get('/v1/provider/football/fixtures?date=2026-11-25').set('x-api-key', 'c'.repeat(40)).expect(200);
      expect(football.body).toMatchObject({ errors: [], response: [] });
      expect(football.headers['cache-control']).toBe('no-store');
      await request(app.getHttpServer()).get('/v1/provider/basketball/games?id=12').set('x-api-key', 'c'.repeat(40)).expect(200);
      await request(app.getHttpServer()).get('/v1/provider/football/odds/live?fixture=12').set('x-api-key', 'c'.repeat(40)).expect(200);
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'https://v3.football.api-sports.io/fixtures?date=2026-11-25',
        'https://v1.basketball.api-sports.io/games?id=12',
        'https://v3.football.api-sports.io/odds/live?fixture=12',
      ]);
    } finally {
      await app.close();
      vi.unstubAllGlobals();
      for (const [name, value] of Object.entries({ REDIS_URL: old.redis, API_CLIENTS: old.clients, API_SPORTS_KEY: old.key })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
