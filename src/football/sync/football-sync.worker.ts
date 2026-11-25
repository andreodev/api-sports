import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { EventsService } from '../../multisport/events.service.js';
import { FootballSyncRepository } from './football-sync.repository.js';
import type { FootballSnapshot } from './football-sync.types.js';

const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
const ADVANCE_CURSOR = `if redis.call('GET',KEYS[1])~=ARGV[1] then return -1 end local n=tonumber(ARGV[2]); local size=tonumber(ARGV[3]); local current=tonumber(redis.call('GET',KEYS[2]) or '0') % n; redis.call('SET',KEYS[2],(current+size)%n,'EX',172800); return current`;

export function upcomingFixtureIds(value: unknown, now: Date): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('Agenda inválida');
  const events = (value as { events: Array<{ externalId?: unknown; startTime?: unknown; status?: { short?: unknown } }> }).events;
  return [...new Set(events.filter((event) => event.status?.short === 'NS' && typeof event.startTime === 'string' && Date.parse(event.startTime) > now.getTime() && typeof event.externalId === 'string' && /^[1-9]\d{0,14}$/.test(event.externalId) && Number.isSafeInteger(Number(event.externalId)))
    .sort((a, b) => Date.parse(a.startTime as string) - Date.parse(b.startTime as string) || String(a.externalId).localeCompare(String(b.externalId)))
    .map((event) => event.externalId as string))];
}

@Injectable()
export class FootballSyncWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(FootballSyncWorker.name);
  private client?: ReturnType<typeof createClient>;
  private running = false;
  constructor(private readonly events: EventsService, private readonly repository: FootballSyncRepository) {}

  @Cron(process.env.FOOTBALL_SYNC_CRON ?? '* * * * *', { name: 'football-sync', waitForCompletion: true })
  async scheduled() { if (process.env.FOOTBALL_SYNC_ENABLED === 'true') await this.run(); }

  async run() {
    if (this.running) return { status: 'busy' as const };
    const configuredIds = [...new Set((process.env.FOOTBALL_SYNC_FIXTURE_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
    const discovery = process.env.FOOTBALL_SYNC_DISCOVERY === 'true';
    if ((discovery && configuredIds.length > 0) || (!discovery && !configuredIds.length) || configuredIds.length > 3 || configuredIds.some((id) => !/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('Configure descoberta ou de uma a três partidas válidas em FOOTBALL_SYNC_FIXTURE_IDS');
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL não configurada');
    this.running = true;
    try {
      if (!this.client) {
        this.client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } });
        this.client.on('error', () => this.logger.error('Redis indisponível no worker'));
      }
      if (!this.client.isOpen) await this.client.connect();
      const token = randomUUID();
      const lock = 'api-sports:football:sync:lock';
      if (!await this.client.set(lock, token, { NX: true, PX: 180_000 })) return { status: 'busy' as const };
      try {
        let ids = configuredIds;
        if (discovery) {
          const now = new Date();
          const date = now.toISOString().slice(0, 10);
          const candidates = upcomingFixtureIds(await this.events.events('football', date, 'background'), now);
          if (await this.client.get(lock) !== token) throw new Error('Lease perdido durante descoberta');
          if (candidates.length) {
            const cursorKey = `api-sports:football:sync:cursor:${date}`;
            const batchSize = Math.min(2, candidates.length);
            const cursor = Number(await this.client.eval(ADVANCE_CURSOR, { keys: [lock, cursorKey], arguments: [token, String(candidates.length), String(batchSize)] }));
            if (cursor < 0) throw new Error('Lease perdido durante descoberta');
            ids = Array.from({ length: batchSize }, (_, index) => candidates[(cursor + index) % candidates.length]);
          }
        }
        const generation = await this.repository.generation();
        const started = new Date();
        let succeeded = 0, failed = 0;
        for (const id of ids) {
          if (await this.client.get(lock) !== token) { failed += ids.length - succeeded - failed; break; }
          try {
            const snapshot = await this.events.footballOdds(id, 'background') as FootballSnapshot;
            if (snapshot.fixtureId !== id || snapshot.bettable !== false || !Array.isArray(snapshot.selections)) throw new Error('Snapshot inválido');
            if (await this.client.get(lock) !== token || !await this.repository.save(generation, snapshot)) throw new Error('Lease perdido ou leitura antiga');
            succeeded++;
          } catch { failed++; this.logger.warn(`Falha ao sincronizar fixture ${id}`); }
        }
        await this.repository.recordRun(generation, started, ids.length, succeeded, failed);
        this.logger.log(`Sincronização: ${succeeded} concluídas, ${failed} falhas`);
        return { status: 'done' as const, requested: ids.length, succeeded, failed };
      } finally { await this.client.eval(RELEASE, { keys: [lock], arguments: [token] }); }
    } finally { this.running = false; }
  }
  async onApplicationShutdown() { if (this.client?.isOpen) await this.client.close(); }
}
