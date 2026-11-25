import { createClient } from 'redis';
import { EventsService } from './events.service.js';
import footballOddsFixture from '../football/__fixtures__/odds-prematch-1641277.json';

describe.skipIf(!process.env.REDIS_TEST_URL)('events integration', () => {
  let originalTestUrl: string | undefined;
  beforeAll(async () => {
    originalTestUrl = process.env.REDIS_TEST_URL;
    const url = new URL(originalTestUrl!); url.pathname = '/11'; process.env.REDIS_TEST_URL = url.toString();
    const redis = createClient({ url: url.toString() }); await redis.connect();
    await redis.del(['api-sports:provider:minute:rolling', 'api-sports:provider:cooldown']); await redis.close();
  });
  afterAll(async () => {
    const redis = createClient({ url: process.env.REDIS_TEST_URL }); await redis.connect();
    await redis.del(['api-sports:provider:minute:rolling', 'api-sports:provider:cooldown']); await redis.close();
    if (originalTestUrl === undefined) delete process.env.REDIS_TEST_URL; else process.env.REDIS_TEST_URL = originalTestUrl;
  });
  it('retries a transient provider failure and does not fetch odds for a suspended match', async () => {
    const oldRedis = process.env.REDIS_URL, oldKey = process.env.API_SPORTS_KEY;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL; process.env.API_SPORTS_KEY = 'test-key';
    const redis = createClient({ url: process.env.REDIS_TEST_URL }); await redis.connect();
    const key = 'api-sports:football:prematch:v1:8:9876543'; await redis.del(key);
    const fixture = { response: [{ fixture: { id: 9876543, date: '2099-01-01T00:00:00Z', status: { short: 'SUSP' } } }], errors: [], paging: { current: 1, total: 1 } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    vi.stubGlobal('fetch', fetchMock);
    const service = new EventsService();
    try {
      expect(await service.footballOdds('9876543')).toMatchObject({ status: 'SUSP', selections: [], bettable: false, reason: 'MATCH_UNAVAILABLE' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals(); await service.onApplicationShutdown(); await redis.del(key); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
    }
  });
  it('maps confirmed prematch football odds and shares them via Redis', async () => {
    const oldRedis = process.env.REDIS_URL, oldKey = process.env.API_SPORTS_KEY, oldBook = process.env.FOOTBALL_BOOKMAKER_ID;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL; process.env.API_SPORTS_KEY = 'test-key'; process.env.FOOTBALL_BOOKMAKER_ID = '8';
    const redis = createClient({ url: process.env.REDIS_TEST_URL }); await redis.connect();
    const key = 'api-sports:football:prematch:v1:8:1641277'; await redis.del(key);
    const fixture = { response: [{ fixture: { id: 1641277, date: '2099-01-01T00:00:00Z', status: { short: 'NS' } } }], errors: [], paging: { current: 1, total: 1 } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture))).mockResolvedValueOnce(new Response(JSON.stringify(footballOddsFixture)));
    vi.stubGlobal('fetch', fetchMock);
    const first = new EventsService(), second = new EventsService();
    try {
      const result = await first.footballOdds('1641277');
      expect(result).toMatchObject({ fixtureId: '1641277', bettable: false, selections: expect.arrayContaining([expect.objectContaining({ type: 'HOME_WIN', value: 3.6 })]) });
      expect(await second.footballOdds('1641277')).toEqual(result);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals(); await first.onApplicationShutdown(); await second.onApplicationShutdown(); await redis.del(key); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
      if (oldBook === undefined) delete process.env.FOOTBALL_BOOKMAKER_ID; else process.env.FOOTBALL_BOOKMAKER_ID = oldBook;
    }
  });
  it('retrieves player selections and caches them without enabling betting', async () => {
    const oldRedis = process.env.REDIS_URL;
    const oldKey = process.env.API_SPORTS_KEY;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    process.env.API_SPORTS_KEY = 'test-provider-key';
    const redis = createClient({ url: process.env.REDIS_TEST_URL });
    await redis.connect();
    const cacheKey = 'api-sports:basketball:player-markets:v2:987654321';
    await redis.del(cacheKey);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [], response: [{ game: { id: 987654321 }, bookmakers: [{ id: 4, name: 'Example', bets: [{ id: 117, name: 'Player Points', values: [{ value: 'Myles Turner - Over 9.5', odd: '1.76' }] }] }] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = new EventsService();
    const second = new EventsService();
    try {
      const result = await first.basketballPlayerMarkets('987654321');
      expect(result).toMatchObject({ gameId: '987654321', bettable: false, combinationPricing: 'UNAVAILABLE', selections: [{ statistic: 'points', playerName: 'Myles Turner', line: 9.5, odd: 1.76, overtimeIncluded: null, providerUpdatedAt: null }] });
      expect(await second.basketballPlayerMarkets('987654321')).toEqual(result);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await first.onApplicationShutdown(); await second.onApplicationShutdown();
      await redis.del(cacheKey); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
    }
  });
  it('normalizes provider events and shares the cached observation', async () => {
    const oldRedis = process.env.REDIS_URL;
    const oldKey = process.env.API_SPORTS_KEY;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    process.env.API_SPORTS_KEY = 'test-provider-key';
    const redis = createClient({ url: process.env.REDIS_TEST_URL });
    await redis.connect();
    const date = '2047-01-23';
    const key = `api-sports:events:v1:basketball:${date}`;
    await redis.del(key);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [], response: [{ id: 77, date: `${date}T20:00:00Z`, status: { short: 'NS', long: 'Not Started' }, league: { id: 12, name: 'NBA', season: '2046-2047' }, teams: { home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' } } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = new EventsService();
    const second = new EventsService();
    try {
      const result = await first.events('basketball', date);
      const cached = await second.events('basketball', date);
      expect(result).toMatchObject({ sport: 'basketball', date, events: [{ externalId: 'apisports:basketball:77', home: { name: 'Home' } }] });
      expect(cached).toEqual(result);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await first.onApplicationShutdown();
      await second.onApplicationShutdown();
      await redis.del(key);
      await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
    }
  });
  it('rejects an incomplete schedule instead of caching a partial list', async () => {
    const oldRedis = process.env.REDIS_URL, oldKey = process.env.API_SPORTS_KEY;
    process.env.REDIS_URL = process.env.REDIS_TEST_URL; process.env.API_SPORTS_KEY = 'test-key';
    const redis = createClient({ url: process.env.REDIS_TEST_URL }); await redis.connect();
    const date = '2047-01-24', key = `api-sports:events:v1:basketball:${date}`;
    await redis.del([key, 'api-sports:provider:minute:rolling']);
    const valid = { id: 77, date: `${date}T20:00:00Z`, status: { short: 'NS' }, league: { id: 12, name: 'NBA' }, teams: { home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ errors: [], response: [valid, { id: 78 }] }))).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [], response: [valid] })));
    vi.stubGlobal('fetch', fetchMock);
    const service = new EventsService();
    try {
      await expect(service.events('basketball', date)).rejects.toMatchObject({ status: 502 });
      expect(await redis.get(key)).toBeNull();
      await expect(service.events('basketball', date)).resolves.toMatchObject({ events: [{ externalId: 'apisports:basketball:77' }] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals(); await service.onApplicationShutdown(); await redis.del([key, 'api-sports:provider:minute:rolling']); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey;
    }
  });
});
