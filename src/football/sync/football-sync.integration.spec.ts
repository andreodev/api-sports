import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { EventsService } from '../../multisport/events.service.js';
import { FootballSyncRepository } from './football-sync.repository.js';
import { FootballSyncWorker } from './football-sync.worker.js';
import type { FootballSnapshot } from './football-sync.types.js';

describe.skipIf(!process.env.DATABASE_TEST_URL || !process.env.REDIS_TEST_URL)('football sync with PostgreSQL and Redis', () => {
  it('fences older runs, tracks price changes, and treats expired odds as unavailable', async () => {
    const originalDb = process.env.DATABASE_URL, originalRedis = process.env.REDIS_URL, originalIds = process.env.FOOTBALL_SYNC_FIXTURE_IDS;
    const dbUrl = new URL(process.env.DATABASE_TEST_URL!);
    if (!dbUrl.pathname.endsWith('_test')) throw new Error('Testes exigem banco dedicado cujo nome termina em _test');
    const redisUrl = new URL(process.env.REDIS_TEST_URL!); redisUrl.pathname = '/13';
    process.env.DATABASE_URL = dbUrl.toString(); process.env.REDIS_URL = redisUrl.toString();
    const id = String(randomInt(100000000, 999999999)); process.env.FOOTBALL_SYNC_FIXTURE_IDS = id;
    const pool = new Pool({ connectionString: dbUrl.toString() });
    const redis = createClient({ url: redisUrl.toString() }); await redis.connect();
    const repository = new FootballSyncRepository();
    const start = Date.now();
    const makeSnapshot = (price: number, at: number): FootballSnapshot => ({ fixtureId: id, bookmakerId: 8, status: 'NS', startTime: new Date(start + 86_400_000).toISOString(), observedAt: new Date(at).toISOString(), providerUpdatedAt: new Date(start - 10_000).toISOString(), reason: 'PREVIEW_ONLY', bettable: false, selections: [{ type: 'HOME_WIN', name: 'Casa', category: 'Resultado', value: price }] });
    let resolveFeed!: (snapshot: FootballSnapshot) => void;
    let feedStarted!: () => void;
    const started = new Promise<void>((resolve) => { feedStarted = resolve; });
    const feed = new Promise<FootballSnapshot>((resolve) => { resolveFeed = resolve; });
    const events = { footballOdds: vi.fn(() => { feedStarted(); return feed; }) } as unknown as EventsService;
    const worker1 = new FootballSyncWorker(events, repository), worker2 = new FootballSyncWorker(events, repository);
    try {
      const running = worker1.run(); await started;
      expect(await worker2.run()).toEqual({ status: 'busy' });
      resolveFeed(makeSnapshot(1.9, start - 1000));
      expect(await running).toMatchObject({ status: 'done', succeeded: 1, failed: 0 });
      const oldGeneration = await repository.generation();
      const generation = await repository.generation();
      expect(await repository.save(oldGeneration, makeSnapshot(2.3, start))).toBe(false);
      expect(await repository.save(generation, makeSnapshot(2.1, start))).toBe(true);
      const { rows } = await pool.query('SELECT price,previous_price,price_changed_at,unavailable,bettable FROM football_sync_current_selections WHERE fixture_id=$1', [id]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].price)).toBe(2.1); expect(Number(rows[0].previous_price)).toBe(1.9);
      expect(rows[0].price_changed_at).toBeInstanceOf(Date); expect(rows[0].unavailable).toBe(false); expect(rows[0].bettable).toBe(false);
      await pool.query("UPDATE football_sync_selections SET expires_at=now()-interval '1 second' WHERE fixture_id=$1", [id]);
      expect((await pool.query('SELECT unavailable,bettable FROM football_sync_current_selections WHERE fixture_id=$1', [id])).rows[0]).toEqual({ unavailable: true, bettable: false });
      const missing = { ...makeSnapshot(2.1, Date.now() + 10), reason: 'ODDS_UNAVAILABLE', selections: [] };
      expect(await repository.save(generation, missing)).toBe(true);
      expect((await pool.query('SELECT suspended,unavailable FROM football_sync_current_selections WHERE fixture_id=$1', [id])).rows[0]).toEqual({ suspended: true, unavailable: true });
    } finally {
      await worker1.onApplicationShutdown(); await worker2.onApplicationShutdown(); await repository.onApplicationShutdown();
      await pool.query('DELETE FROM football_sync_selections WHERE fixture_id=$1', [id]); await pool.query('DELETE FROM football_sync_markets WHERE fixture_id=$1', [id]); await pool.query('DELETE FROM football_sync_fixtures WHERE external_id=$1', [id]);
      await pool.end(); await redis.close();
      if (originalDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDb;
      if (originalRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalRedis;
      if (originalIds === undefined) delete process.env.FOOTBALL_SYNC_FIXTURE_IDS; else process.env.FOOTBALL_SYNC_FIXTURE_IDS = originalIds;
    }
  });
});
