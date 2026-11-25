import { createClient } from 'redis';
import { EventsService } from '../../multisport/events.service.js';
import { FootballSyncRepository } from './football-sync.repository.js';
import { FootballSyncWorker, upcomingFixtureIds } from './football-sync.worker.js';

describe('football schedule discovery', () => {
  it('selects unique future scheduled fixtures in start order', () => {
    const event = (id: string, startTime: string, short = 'NS') => ({ externalId: id, startTime, status: { short } });
    expect(upcomingFixtureIds({ events: [event('2', '2099-01-01T02:00:00Z'), event('1', '2099-01-01T01:00:00Z'), event('1', '2099-01-01T01:00:00Z'), event('3', '2099-01-01T03:00:00Z', 'FT'), event('4', '2020-01-01T00:00:00Z')] }, new Date('2099-01-01T00:00:00Z'))).toEqual(['1', '2']);
    expect(() => upcomingFixtureIds({}, new Date())).toThrow();
  });

  it.skipIf(!process.env.REDIS_TEST_URL)('rotates batches across runs without synchronizing more than two fixtures', async () => {
    const oldRedis = process.env.REDIS_URL, oldIds = process.env.FOOTBALL_SYNC_FIXTURE_IDS, oldDiscovery = process.env.FOOTBALL_SYNC_DISCOVERY;
    const url = new URL(process.env.REDIS_TEST_URL!); url.pathname = '/10';
    process.env.REDIS_URL = url.toString(); process.env.FOOTBALL_SYNC_DISCOVERY = 'true'; delete process.env.FOOTBALL_SYNC_FIXTURE_IDS;
    const redis = createClient({ url: url.toString() }); await redis.connect();
    const date = new Date().toISOString().slice(0, 10), cursor = `api-sports:football:sync:cursor:${date}`;
    await redis.del([cursor, 'api-sports:football:sync:lock']);
    const fixtures = ['1', '2', '3', '4', '5'].map((externalId) => ({ externalId, startTime: '2099-01-01T00:00:00Z', status: { short: 'NS' } }));
    const footballOdds = vi.fn(async (fixtureId: string) => ({ fixtureId, bettable: false, selections: [] }));
    const events = { events: vi.fn(async () => ({ events: fixtures })), footballOdds } as unknown as EventsService;
    const repository = { generation: vi.fn(async () => '1'), save: vi.fn(async () => true), recordRun: vi.fn(async () => undefined) } as unknown as FootballSyncRepository;
    const worker = new FootballSyncWorker(events, repository);
    try {
      expect(await worker.run()).toMatchObject({ requested: 2, succeeded: 2 });
      expect(await worker.run()).toMatchObject({ requested: 2, succeeded: 2 });
      expect(await worker.run()).toMatchObject({ requested: 2, succeeded: 2 });
      expect(footballOdds.mock.calls.map(([id]) => id)).toEqual(['1', '2', '3', '4', '5', '1']);
    } finally {
      await worker.onApplicationShutdown(); await redis.del([cursor, 'api-sports:football:sync:lock']); await redis.close();
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
      if (oldIds === undefined) delete process.env.FOOTBALL_SYNC_FIXTURE_IDS; else process.env.FOOTBALL_SYNC_FIXTURE_IDS = oldIds;
      if (oldDiscovery === undefined) delete process.env.FOOTBALL_SYNC_DISCOVERY; else process.env.FOOTBALL_SYNC_DISCOVERY = oldDiscovery;
    }
  });
});
