import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { marketGroup, type FootballSnapshot } from './football-sync.types.js';

@Injectable()
export class FootballSyncRepository implements OnApplicationShutdown {
  private pool?: Pool;
  private db() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
    return this.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
  }
  async generation(): Promise<string> {
    const result = await this.db().query<{ generation: string }>('UPDATE football_sync_control SET generation=generation+1 WHERE id=1 RETURNING generation');
    if (!result.rows[0]) throw new Error('Migração de sincronização não aplicada');
    return result.rows[0].generation;
  }
  async save(generation: string, snapshot: FootballSnapshot): Promise<boolean> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const fence = await client.query('SELECT generation FROM football_sync_control WHERE id=1 FOR UPDATE');
      if (String(fence.rows[0]?.generation) !== generation) { await client.query('ROLLBACK'); return false; }
      const observed = new Date(snapshot.observedAt);
      if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() + 1000) throw new Error('Observação inválida');
      const update = snapshot.providerUpdatedAt ? new Date(snapshot.providerUpdatedAt) : null;
      const providerMs = update && Number.isFinite(update.getTime()) && update.getTime() <= observed.getTime() ? update.getTime() : 0;
      const startTime = snapshot.startTime ? new Date(snapshot.startTime) : null;
      const startMs = startTime && Number.isFinite(startTime.getTime()) ? startTime.getTime() : 0;
      const expires = new Date(Math.min(observed.getTime() + 60_000, providerMs ? providerMs + 24 * 60 * 60_000 : observed.getTime(), startMs || observed.getTime()));
      const available = snapshot.reason === 'PREVIEW_ONLY' && expires.getTime() > Date.now();
      const inserted = await client.query('INSERT INTO football_sync_fixtures (external_id,status,start_time,observed_at) VALUES ($1,$2,$3,$4) ON CONFLICT (external_id) DO UPDATE SET status=EXCLUDED.status, start_time=EXCLUDED.start_time, observed_at=EXCLUDED.observed_at, updated_at=now() WHERE football_sync_fixtures.observed_at < EXCLUDED.observed_at RETURNING external_id', [snapshot.fixtureId, snapshot.status, startMs ? startTime : null, observed]);
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return false; }
      await client.query('UPDATE football_sync_markets SET suspended=true, observed_at=$3, expires_at=$3 WHERE fixture_id=$1 AND bookmaker_id=$2', [snapshot.fixtureId, snapshot.bookmakerId, observed]);
      await client.query('UPDATE football_sync_selections SET suspended=true, observed_at=$3, expires_at=$3 WHERE fixture_id=$1 AND bookmaker_id=$2', [snapshot.fixtureId, snapshot.bookmakerId, observed]);
      for (const selection of snapshot.selections) {
        const group = marketGroup(selection.type);
        if (!group || !Number.isFinite(selection.value) || selection.value <= 1 || selection.value > 10_000) continue;
        await client.query('INSERT INTO football_sync_markets (fixture_id,bookmaker_id,market_group,suspended,observed_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (fixture_id,bookmaker_id,market_group) DO UPDATE SET suspended=EXCLUDED.suspended,observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at', [snapshot.fixtureId, snapshot.bookmakerId, group, !available, observed, expires]);
        await client.query('INSERT INTO football_sync_selections (fixture_id,bookmaker_id,market_group,selection_type,name,price,suspended,observed_at,provider_updated_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (fixture_id,bookmaker_id,selection_type) DO UPDATE SET name=EXCLUDED.name, previous_price=CASE WHEN football_sync_selections.price<>EXCLUDED.price THEN football_sync_selections.price ELSE football_sync_selections.previous_price END, price_changed_at=CASE WHEN football_sync_selections.price<>EXCLUDED.price THEN EXCLUDED.observed_at ELSE football_sync_selections.price_changed_at END, price=EXCLUDED.price,suspended=EXCLUDED.suspended,observed_at=EXCLUDED.observed_at,provider_updated_at=EXCLUDED.provider_updated_at,expires_at=EXCLUDED.expires_at', [snapshot.fixtureId, snapshot.bookmakerId, group, selection.type, selection.name, selection.value, !available, observed, providerMs ? update : null, expires]);
      }
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async recordRun(generation: string, startedAt: Date, requested: number, succeeded: number, failed: number) {
    await this.db().query('INSERT INTO football_sync_runs (generation,started_at,requested,succeeded,failed) VALUES ($1,$2,$3,$4,$5)', [generation, startedAt, requested, succeeded, failed]);
  }
  async read(fixtureId: string) {
    const fixture = await this.db().query('SELECT external_id,status,start_time,observed_at FROM football_sync_fixtures WHERE external_id=$1', [fixtureId]);
    if (!fixture.rows[0]) return null;
    const selections = await this.db().query('SELECT bookmaker_id,market_group,selection_type,name,price,previous_price,price_changed_at,observed_at,provider_updated_at,expires_at,unavailable,bettable FROM football_sync_current_selections WHERE fixture_id=$1 ORDER BY bookmaker_id,market_group,selection_type', [fixtureId]);
    return { fixtureId, status: fixture.rows[0].status, startTime: fixture.rows[0].start_time, observedAt: fixture.rows[0].observed_at, selections: selections.rows, bettable: false };
  }
  async onApplicationShutdown() { await this.pool?.end(); }
}
