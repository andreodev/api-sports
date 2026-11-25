import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import { EventsService } from '../multisport/events.service.js';
import { BasketballSyncRepository } from './basketball-sync.repository.js';
import { BasketballSyncWorker } from './basketball-sync.worker.js';
import type { BasketballGame, PlayerSnapshot } from './basketball-sync.types.js';

const dbUrl = process.env.DATABASE_TEST_URL;
const redisUrl = process.env.REDIS_TEST_URL;
const safe = (() => {
  if (!dbUrl || !redisUrl) return false;
  try {
    const db = new URL(dbUrl), redis = new URL(redisUrl);
    return ['localhost', '127.0.0.1'].includes(db.hostname) && db.pathname.endsWith('_test') && ['localhost', '127.0.0.1'].includes(redis.hostname) && redis.pathname === '/12';
  } catch { return false; }
})();

describe.skipIf(!safe)('basketball sync with isolated PostgreSQL and Redis', () => {
  it('prevents concurrent workers, fences stale writes and suspends missing or expired selections', async () => {
    const previous = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL, leagues: process.env.BASKETBALL_SYNC_LEAGUE_IDS, size: process.env.BASKETBALL_SYNC_BATCH_SIZE };
    process.env.DATABASE_URL = dbUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.BASKETBALL_SYNC_LEAGUE_IDS = '12';
    process.env.BASKETBALL_SYNC_BATCH_SIZE = '2';
    const id = String(randomInt(100000000, 999999999));
    const now = Date.now();
    const start = new Date(now + 60 * 60_000).toISOString();
    const game: BasketballGame = { externalId: `apisports:basketball:${id}`, providerId: id, sportId: 'basketball', phase: 'scheduled', statusShort: 'NS', startTime: start, observedAt: new Date(now - 1000).toISOString(), league: { providerId: '12', name: 'NBA' }, home: { id: '1', name: 'Home' }, away: { id: '2', name: 'Away' } };
    const makeSnapshot = (odd: number, observed: number): PlayerSnapshot => ({ gameId: id, observedAt: new Date(observed).toISOString(), bettable: false, selections: [{ bookmakerId: 8, bookmaker: 'Example', providerMarketId: 117, providerMarketName: 'Player Points', playerName: 'Test Player', team: null, statistic: 'points', side: 'over', line: 34.5, odd, providerLabel: 'Test Player - Over 34.5', overtimeIncluded: null, providerUpdatedAt: new Date(now - 5000).toISOString() }] });
    let releaseFeed!: (snapshot: PlayerSnapshot) => void, announce!: () => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    const delayed = new Promise<PlayerSnapshot>((resolve) => { releaseFeed = resolve; });
    const events = { events: vi.fn(async (_sport: string, date: string) => ({ events: date === start.slice(0, 10) ? [game] : [] })), basketballPlayerMarkets: vi.fn(() => { announce(); return delayed; }) } as unknown as EventsService;
    const repository = new BasketballSyncRepository();
    const first = new BasketballSyncWorker(events, repository), second = new BasketballSyncWorker(events, repository);
    const pool = new Pool({ connectionString: dbUrl });
    try {
      const running = first.run(); await started;
      expect(await second.run()).toEqual({ status: 'busy' });
      releaseFeed(makeSnapshot(1.9, now - 500));
      expect(await running).toMatchObject({ status: 'done', games: 1, succeeded: 1, failed: 0 });
      const oldGeneration = await repository.generation(), generation = await repository.generation();
      expect(await repository.saveSelections(oldGeneration, makeSnapshot(2.2, now))).toBe(false);
      expect(await repository.saveSelections(generation, makeSnapshot(2.1, now))).toBe(true);
      let current = await repository.read(id);
      expect(current).toMatchObject({ gameId: id, bettable: false, selections: [{ player_name: 'Test Player', unavailable: false, bettable: false }] });
      expect(Number(current!.selections[0].price)).toBe(2.1);
      expect(Number(current!.selections[0].previous_price)).toBe(1.9);
      await expect(repository.saveSelections(generation, { ...makeSnapshot(2.2, now + 1), selections: [...makeSnapshot(2.2, now + 1).selections, ...makeSnapshot(2.2, now + 1).selections] })).rejects.toThrow();
      current = await repository.read(id);
      expect(current!.selections[0].unavailable).toBe(false);
      expect(await repository.saveSelections(generation, { ...makeSnapshot(2.3, now + 2), selections: [] })).toBe(true);
      expect((await repository.read(id))!.selections[0].unavailable).toBe(true);
      expect(await repository.saveSelections(generation, makeSnapshot(2.5, now - 100))).toBe(false);
      const finished = { ...game, phase: 'finished', statusShort: 'AOT', startTime: new Date(now - 4 * 60 * 60_000).toISOString(), observedAt: new Date(now + 1).toISOString() };
      expect(await repository.saveGames(generation, [finished])).toBe(true);
      const statsRow = (playerId: number, teamId: number) => ({ game: { id: Number(id) }, player: { id: playerId, name: `Player ${playerId}` }, team: { id: teamId }, minutes: '15:20', points: 18, rebounds: { total: 7 }, assists: 4 });
      const stats = { gameId: id, observedAt: new Date(now + 2).toISOString(), settlementReady: false as const, rows: [statsRow(101, 1), statsRow(102, 2)] };
      expect(await repository.saveStatistics(oldGeneration, finished, stats)).toBe(false);
      expect(await repository.saveStatistics(generation, finished, stats)).toBe(true);
      expect(await repository.read(id)).toMatchObject({ settlementReady: false, statistics: [{ player_id: '101', points: 18 }, { player_id: '102', rebounds: 7 }] });
      expect(await repository.saveStatistics(generation, finished, { ...stats, observedAt: new Date(now + 3).toISOString(), rows: [statsRow(103, 1), statsRow(102, 2)] })).toBe(true);
      expect((await repository.read(id))!.statistics.map((player) => player.player_id)).toEqual(['103', '102']);
      await expect(repository.saveStatistics(generation, finished, { ...stats, observedAt: new Date(now + 4).toISOString(), rows: [statsRow(103, 1)] })).rejects.toThrow();
      expect((await repository.read(id))!.statistics).toHaveLength(2);
    } finally {
      await first.onApplicationShutdown(); await second.onApplicationShutdown(); await repository.onApplicationShutdown();
      await pool.query('DELETE FROM basketball_sync_player_selections WHERE game_id=$1', [id]);
      await pool.query('DELETE FROM basketball_sync_player_statistics WHERE game_id=$1', [id]);
      await pool.query('DELETE FROM basketball_sync_games WHERE external_id=$1', [id]);
      await pool.end();
      for (const [name, value] of Object.entries({ DATABASE_URL: previous.db, REDIS_URL: previous.redis, BASKETBALL_SYNC_LEAGUE_IDS: previous.leagues, BASKETBALL_SYNC_BATCH_SIZE: previous.size })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
