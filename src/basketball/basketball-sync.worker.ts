import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { EventsService } from '../multisport/events.service.js';
import { BasketballSyncRepository } from './basketball-sync.repository.js';
import { validGame, type BasketballGame, type PlayerSnapshot } from './basketball-sync.types.js';

const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
const ADVANCE = `if redis.call('GET',KEYS[1])~=ARGV[1] then return -1 end local n=tonumber(ARGV[2]); local size=tonumber(ARGV[3]); local current=tonumber(redis.call('GET',KEYS[2]) or '0') % n; redis.call('SET',KEYS[2],(current+size)%n,'EX',172800); return current`;

export function basketballCandidates(data: unknown, date: string, leagueIds: Set<string>, now: number): BasketballGame[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { events?: unknown }).events)) throw new Error('Agenda de basquete inválida');
  const games = (data as { events: BasketballGame[] }).events.filter((game) => leagueIds.size === 0 || leagueIds.has(game?.league?.providerId ?? ''));
  if (games.some((game) => !validGame(game, now) || game.startTime.slice(0, 10) !== date) || new Set(games.map((game) => game.providerId)).size !== games.length) throw new Error('Agenda de basquete incompleta ou inválida');
  return games;
}

@Injectable()
export class BasketballSyncWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(BasketballSyncWorker.name);
  private client?: ReturnType<typeof createClient>;
  private running = false;
  constructor(private readonly events: EventsService, private readonly repository: BasketballSyncRepository) {}

  @Cron(process.env.BASKETBALL_SYNC_CRON ?? '* * * * *', { name: 'basketball-sync', waitForCompletion: true })
  async scheduled() { if (process.env.BASKETBALL_SYNC_ENABLED === 'true') await this.run(); }

  async run() {
    if (this.running) return { status: 'busy' as const };
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL não configurada');
    const leagueList = [...new Set((process.env.BASKETBALL_SYNC_LEAGUE_IDS ?? '12').split(',').map((id) => id.trim()).filter(Boolean))];
    if (leagueList.length > 10 || leagueList.some((id) => !/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('Ligas de basquete inválidas');
    const batchSize = Number(process.env.BASKETBALL_SYNC_BATCH_SIZE ?? '2');
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 3) throw new Error('Lote de basquete deve ter de uma a três partidas');
    this.running = true;
    try {
      if (!this.client) {
        this.client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } });
        this.client.on('error', () => this.logger.error('Redis indisponível no worker de basquete'));
      }
      if (!this.client.isOpen) await this.client.connect();
      const token = randomUUID();
      const lock = 'api-sports:basketball:sync:lock';
      if (!await this.client.set(lock, token, { NX: true, PX: 180_000 })) return { status: 'busy' as const };
      try {
        const now = Date.now();
        const leagues = new Set(leagueList);
        const collected = new Map<string, BasketballGame>();
        for (const day of [-1, 0, 1]) {
          const date = new Date(now + day * 86_400_000).toISOString().slice(0, 10);
          const games = basketballCandidates(await this.events.events('basketball', date, 'background'), date, leagues, now);
          for (const game of games) {
            if (collected.has(game.providerId)) throw new Error('Partida duplicada na agenda');
            collected.set(game.providerId, game);
          }
        }
        if (await this.client.get(lock) !== token) throw new Error('Lease de basquete perdido');
        const generation = await this.repository.generation();
        const started = new Date();
        if (!await this.repository.saveGames(generation, [...collected.values()])) throw new Error('Geração de basquete substituída');
        const candidates = [...collected.values()].filter((game) => game.phase === 'scheduled' && Date.parse(game.startTime) > now).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.providerId.localeCompare(b.providerId));
        let selected: BasketballGame[] = [];
        if (candidates.length) {
          const size = Math.min(batchSize, candidates.length);
          const cursor = Number(await this.client.eval(ADVANCE, { keys: [lock, 'api-sports:basketball:sync:cursor'], arguments: [token, String(candidates.length), String(size)] }));
          if (cursor < 0) throw new Error('Lease de basquete perdido');
          selected = Array.from({ length: size }, (_, index) => candidates[(cursor + index) % candidates.length]);
        }
        let succeeded = 0, failed = 0;
        for (const game of selected) {
          if (await this.client.get(lock) !== token) { failed += selected.length - succeeded - failed; break; }
          try {
            const snapshot = await this.events.basketballPlayerMarkets(game.providerId, 'background') as PlayerSnapshot;
            if (snapshot.gameId !== game.providerId || snapshot.bettable !== false || !Array.isArray(snapshot.selections)) throw new Error('Snapshot de basquete inválido');
            if (await this.client.get(lock) !== token || !await this.repository.saveSelections(generation, snapshot)) throw new Error('Lease perdido ou leitura antiga');
            succeeded++;
          } catch { failed++; this.logger.warn(`Falha ao sincronizar jogo de basquete ${game.providerId}`); }
        }
        const finished = [...collected.values()].filter((game) => game.phase === 'finished' && ['FT', 'AOT'].includes(game.statusShort)).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime) || a.providerId.localeCompare(b.providerId));
        let statisticsSucceeded = 0, statisticsFailed = 0;
        if (finished.length) {
          const cursor = Number(await this.client.eval(ADVANCE, { keys: [lock, 'api-sports:basketball:sync:finished-cursor'], arguments: [token, String(finished.length), '1'] }));
          if (cursor < 0) throw new Error('Lease de basquete perdido');
          const game = finished[cursor];
          try {
            const stats = await this.events.basketballPlayerStatistics(game.providerId, 'background');
            if (await this.client.get(lock) !== token || !await this.repository.saveStatistics(generation, game, stats)) throw new Error('Estatísticas antigas ou lease perdido');
            statisticsSucceeded++;
          } catch { statisticsFailed++; this.logger.warn(`Falha ao sincronizar estatísticas do jogo ${game.providerId}`); }
        }
        await this.repository.recordRun(generation, started, selected.length + statisticsSucceeded + statisticsFailed, succeeded + statisticsSucceeded, failed + statisticsFailed);
        this.logger.log(`Basquete: ${collected.size} jogos, ${succeeded} mercados e ${statisticsSucceeded} estatísticas consultadas, ${failed + statisticsFailed} falhas`);
        return { status: 'done' as const, games: collected.size, requested: selected.length, succeeded, failed, statisticsSucceeded, statisticsFailed };
      } finally { await this.client.eval(RELEASE, { keys: [lock], arguments: [token] }); }
    } finally { this.running = false; }
  }
  async onApplicationShutdown() { if (this.client?.isOpen) await this.client.close(); }
}
