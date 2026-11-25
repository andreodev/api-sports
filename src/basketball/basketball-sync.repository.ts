import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { playerStatistics, selectionKey, validGame, type BasketballGame, type PlayerSnapshot } from './basketball-sync.types.js';

@Injectable()
export class BasketballSyncRepository implements OnApplicationShutdown {
  private pool?: Pool;
  private db() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
    return this.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
  }

  async generation(): Promise<string> {
    const result = await this.db().query<{ generation: string }>('UPDATE basketball_sync_control SET generation=generation+1 WHERE id=1 RETURNING generation');
    if (!result.rows[0]) throw new Error('Migration de basquete não aplicada');
    return result.rows[0].generation;
  }

  async saveGames(generation: string, games: BasketballGame[]): Promise<boolean> {
    if (games.length > 2000 || games.some((game) => !validGame(game, Date.now())) || new Set(games.map((game) => game.providerId)).size !== games.length) throw new Error('Agenda de basquete inválida');
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const fence = await client.query('SELECT generation FROM basketball_sync_control WHERE id=1 FOR UPDATE');
      if (String(fence.rows[0]?.generation) !== generation) { await client.query('ROLLBACK'); return false; }
      for (const game of games) {
        await client.query(`INSERT INTO basketball_sync_games (external_id,league_id,league_name,home_id,home_name,away_id,away_name,phase,status_short,start_time,observed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (external_id) DO UPDATE SET league_id=EXCLUDED.league_id,league_name=EXCLUDED.league_name,home_id=EXCLUDED.home_id,home_name=EXCLUDED.home_name,away_id=EXCLUDED.away_id,away_name=EXCLUDED.away_name,phase=EXCLUDED.phase,status_short=EXCLUDED.status_short,start_time=EXCLUDED.start_time,observed_at=EXCLUDED.observed_at,updated_at=now()
          WHERE basketball_sync_games.observed_at < EXCLUDED.observed_at`, [game.providerId, game.league!.providerId, game.league!.name, game.home!.id, game.home!.name, game.away!.id, game.away!.name, game.phase, game.statusShort, game.startTime, game.observedAt]);
      }
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async saveSelections(generation: string, snapshot: PlayerSnapshot): Promise<boolean> {
    const observedMs = Date.parse(snapshot.observedAt);
    if (!/^[1-9]\d{0,14}$/.test(snapshot.gameId) || !Number.isSafeInteger(Number(snapshot.gameId)) || snapshot.bettable !== false || !Number.isFinite(observedMs) || observedMs > Date.now() + 5000 || !Array.isArray(snapshot.selections) || snapshot.selections.length > 5000) throw new Error('Leitura de mercados inválida');
    const keys = snapshot.selections.map(selectionKey);
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) throw new Error('Seleções inválidas ou duplicadas');
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const fence = await client.query('SELECT generation FROM basketball_sync_control WHERE id=1 FOR UPDATE');
      if (String(fence.rows[0]?.generation) !== generation) { await client.query('ROLLBACK'); return false; }
      const game = await client.query<{ start_time: Date }>(`UPDATE basketball_sync_games SET odds_observed_at=$2
        WHERE external_id=$1 AND phase='scheduled' AND start_time>now() AND (odds_observed_at IS NULL OR odds_observed_at<$2) RETURNING start_time`, [snapshot.gameId, new Date(observedMs)]);
      if (!game.rows[0]) { await client.query('ROLLBACK'); return false; }
      await client.query('UPDATE basketball_sync_player_selections SET suspended=true,expires_at=$2 WHERE game_id=$1', [snapshot.gameId, new Date(observedMs)]);
      for (const [index, item] of snapshot.selections.entries()) {
        const update = item.providerUpdatedAt ? Date.parse(item.providerUpdatedAt) : NaN;
        const updateValid = Number.isFinite(update) && update <= observedMs;
        const expiryMs = Math.min(observedMs + 60_000, updateValid ? update + 24 * 60 * 60_000 : observedMs, game.rows[0].start_time.getTime());
        await client.query(`INSERT INTO basketball_sync_player_selections (game_id,selection_key,bookmaker_id,bookmaker_name,provider_market_id,player_name,team_side,statistic,selection_side,line,price,suspended,observed_at,provider_updated_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (game_id,selection_key) DO UPDATE SET bookmaker_name=EXCLUDED.bookmaker_name,previous_price=CASE WHEN basketball_sync_player_selections.price<>EXCLUDED.price THEN basketball_sync_player_selections.price ELSE basketball_sync_player_selections.previous_price END,price_changed_at=CASE WHEN basketball_sync_player_selections.price<>EXCLUDED.price THEN EXCLUDED.observed_at ELSE basketball_sync_player_selections.price_changed_at END,price=EXCLUDED.price,suspended=EXCLUDED.suspended,observed_at=EXCLUDED.observed_at,provider_updated_at=EXCLUDED.provider_updated_at,expires_at=EXCLUDED.expires_at`,
          [snapshot.gameId, keys[index], item.bookmakerId, item.bookmaker, item.providerMarketId, item.playerName, item.team, item.statistic, item.side, item.line, item.odd, expiryMs <= Date.now(), new Date(observedMs), updateValid ? new Date(update) : null, new Date(expiryMs)]);
      }
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async recordRun(generation: string, startedAt: Date, requested: number, succeeded: number, failed: number) {
    await this.db().query('INSERT INTO basketball_sync_runs (generation,started_at,requested,succeeded,failed) VALUES ($1,$2,$3,$4,$5)', [generation, startedAt, requested, succeeded, failed]);
  }

  async saveStatistics(generation: string, game: BasketballGame, observation: { gameId: string; observedAt: string; rows: unknown; settlementReady: false }): Promise<boolean> {
    const observed = Date.parse(observation.observedAt);
    if (!validGame(game, Date.now()) || game.phase !== 'finished' || observation.gameId !== game.providerId || observation.settlementReady !== false || !Number.isFinite(observed) || observed > Date.now() + 5000) throw new Error('Observação de estatísticas inválida');
    const players = playerStatistics(game, observation.rows);
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const fence = await client.query('SELECT generation FROM basketball_sync_control WHERE id=1 FOR UPDATE');
      if (String(fence.rows[0]?.generation) !== generation) { await client.query('ROLLBACK'); return false; }
      const updated = await client.query(`UPDATE basketball_sync_games SET stats_observed_at=$2 WHERE external_id=$1 AND phase='finished' AND home_id=$3 AND away_id=$4 AND (stats_observed_at IS NULL OR stats_observed_at<$2) RETURNING external_id`, [game.providerId, new Date(observed), game.home!.id, game.away!.id]);
      if (!updated.rowCount) { await client.query('ROLLBACK'); return false; }
      for (const player of players) {
        await client.query(`INSERT INTO basketball_sync_player_statistics (game_id,player_id,team_id,player_name,minutes_played,points,rebounds,assists,observed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (game_id,player_id) DO UPDATE SET team_id=EXCLUDED.team_id,player_name=EXCLUDED.player_name,minutes_played=EXCLUDED.minutes_played,points=EXCLUDED.points,rebounds=EXCLUDED.rebounds,assists=EXCLUDED.assists,observed_at=EXCLUDED.observed_at`,
          [game.providerId, player.playerId, player.teamId, player.playerName, player.minutes, player.points, player.rebounds, player.assists, new Date(observed)]);
      }
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async read(id: string) {
    const game = await this.db().query('SELECT external_id,league_id,league_name,home_id,home_name,away_id,away_name,phase,status_short,start_time,observed_at,odds_observed_at,stats_observed_at FROM basketball_sync_games WHERE external_id=$1', [id]);
    if (!game.rows[0]) return null;
    const selections = await this.db().query('SELECT selection_key,bookmaker_id,bookmaker_name,provider_market_id,player_name,team_side,statistic,selection_side,line,price,previous_price,price_changed_at,observed_at,provider_updated_at,expires_at,unavailable,bettable FROM basketball_sync_current_selections WHERE game_id=$1 ORDER BY statistic,player_name,bookmaker_id,line,selection_side', [id]);
    const statistics = await this.db().query('SELECT player_id,team_id,player_name,minutes_played,points,rebounds,assists,observed_at FROM basketball_sync_player_statistics WHERE game_id=$1 AND observed_at=$2 ORDER BY team_id,player_id', [id, game.rows[0].stats_observed_at]);
    return { gameId: id, game: game.rows[0], selections: selections.rows, statistics: statistics.rows, settlementReady: false, bettable: false };
  }
  async onApplicationShutdown() { await this.pool?.end(); }
}
