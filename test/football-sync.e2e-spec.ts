import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { FootballSyncRepository } from '../src/football/sync/football-sync.repository.js';

describe.skipIf(!process.env.DATABASE_TEST_URL || !process.env.REDIS_TEST_URL)('football sync HTTP', () => {
  it('serves expired snapshots as unavailable and never bettable', async () => {
    const original = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL, clients: process.env.API_CLIENTS };
    const dbUrl = new URL(process.env.DATABASE_TEST_URL!);
    if (!dbUrl.pathname.endsWith('_test')) throw new Error('É necessário um banco de teste dedicado');
    const redisUrl = new URL(process.env.REDIS_TEST_URL!); redisUrl.pathname = '/12';
    process.env.DATABASE_URL = dbUrl.toString(); process.env.REDIS_URL = redisUrl.toString(); process.env.API_CLIENTS = JSON.stringify({ e2e: 'z'.repeat(40) });
    const id = String(randomInt(100000000, 999999999));
    const pool = new Pool({ connectionString: dbUrl.toString() });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = module.createNestApplication();
    try {
      await app.init();
      const repository = module.get(FootballSyncRepository), generation = await repository.generation(), now = Date.now();
      await repository.save(generation, { fixtureId: id, bookmakerId: 8, status: 'NS', startTime: new Date(now + 86400000).toISOString(), observedAt: new Date(now).toISOString(), providerUpdatedAt: new Date(now - 10000).toISOString(), reason: 'PREVIEW_ONLY', bettable: false, selections: [{ type: 'HOME_WIN', name: 'Casa', category: 'Resultado', value: 1.9 }] });
      await pool.query("UPDATE football_sync_selections SET expires_at=now()-interval '1 second' WHERE fixture_id=$1", [id]);
      const response = await request(app.getHttpServer()).get(`/v1/sports/football/fixtures/${id}/sync`).set('x-api-key', 'z'.repeat(40)).expect(200);
      expect(response.body).toMatchObject({ fixtureId: id, bettable: false, selections: [{ selection_type: 'HOME_WIN', unavailable: true, bettable: false }] });
    } finally {
      await app.close();
      await pool.query('DELETE FROM football_sync_selections WHERE fixture_id=$1', [id]); await pool.query('DELETE FROM football_sync_markets WHERE fixture_id=$1', [id]); await pool.query('DELETE FROM football_sync_fixtures WHERE external_id=$1', [id]); await pool.end();
      if (original.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.db;
      if (original.redis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = original.redis;
      if (original.clients === undefined) delete process.env.API_CLIENTS; else process.env.API_CLIENTS = original.clients;
    }
  });
});
