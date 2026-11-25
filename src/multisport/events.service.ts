import { BadGatewayException, BadRequestException, Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { normalizeEvent } from './mapper.js';
import { isApiSportsDate } from './provider-date.js';
import { apiSportOf } from './sports-catalog.js';
import { basketballPlayerMarkets } from './basketball-player-markets.js';
import { normalizeFootballFixture } from '../football/fixtures.js';
import { mapPrematchOdds } from '../football/football-odds.js';

export const PROVIDER_QUOTA = `
local t=redis.call('TIME')
local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-60000)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now-60000)
local count=redis.call('ZCARD',KEYS[1])
local maxMinute=tonumber(ARGV[4] or '10')
local maxBackground=tonumber(ARGV[5] or '6')
if count>=maxMinute then return 0 end
if ARGV[2]=='background' and redis.call('ZCARD',KEYS[2])>=maxBackground then return 0 end
local dailyLimit=tonumber(ARGV[3])
local daily=tonumber(redis.call('GET',KEYS[3]) or '0')
if dailyLimit>0 and (daily>=dailyLimit or (ARGV[2]=='background' and daily>=math.floor(dailyLimit*0.8))) then return 0 end
redis.call('ZADD',KEYS[1],now,ARGV[1])
redis.call('PEXPIRE',KEYS[1],60000)
if ARGV[2]=='background' then redis.call('ZADD',KEYS[2],now,ARGV[1]); redis.call('PEXPIRE',KEYS[2],60000) end
if dailyLimit>0 then redis.call('INCR',KEYS[3]); redis.call('EXPIRE',KEYS[3],86400-(tonumber(t[1])%86400)) end
return 1`;
const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;

@Injectable()
export class EventsService implements OnApplicationShutdown {
  private client?: ReturnType<typeof createClient>;
  private connecting?: Promise<unknown>;

  private async checkProviderQuota(redis: Awaited<ReturnType<EventsService['redis']>>, scope: string) {
    if (await redis.get('api-sports:provider:cooldown')) throw new ServiceUnavailableException('Provedor temporariamente limitado');
    if (await redis.get(`api-sports:provider:minute-exhausted:${scope}`)) throw new ServiceUnavailableException('Limite por minuto do provedor atingido');
    if (await redis.get(`api-sports:provider:daily-exhausted:${scope}`)) throw new ServiceUnavailableException('Cota diária do provedor esgotada');
  }

  private async admit(redis: Awaited<ReturnType<EventsService['redis']>>, priority: 'interactive' | 'background', scope: string) {
    const configured = process.env.API_SPORTS_DAILY_LIMIT ?? '0';
    if (!/^\d{1,7}$/.test(configured)) throw new ServiceUnavailableException('Limite diário inválido');
    const maxMinute = process.env.API_SPORTS_MAX_REQUESTS_PER_MINUTE ?? '10';
    const maxBackground = process.env.API_SPORTS_BACKGROUND_MAX_REQUESTS_PER_MINUTE ?? '6';
    if (!/^\d{1,4}$/.test(maxMinute) || !/^\d{1,4}$/.test(maxBackground) || Number(maxMinute) < 2 || Number(maxMinute) > 1200 || Number(maxBackground) < 1 || Number(maxBackground) >= Number(maxMinute)) throw new ServiceUnavailableException('Limite de consultas por minuto inválido');
    const admitted = await redis.eval(PROVIDER_QUOTA, { keys: ['api-sports:provider:minute:rolling', 'api-sports:provider:minute:background', `api-sports:provider:daily-used:${scope}`], arguments: [randomUUID(), priority, configured, maxMinute, maxBackground] });
    if (admitted !== 1) throw new ServiceUnavailableException('Limite local da API-Sports atingido');
  }

  private async observeRateLimit(redis: Awaited<ReturnType<EventsService['redis']>>, response: Response, scope: string) {
    const minuteRemaining = response.headers.get('x-ratelimit-remaining');
    if (minuteRemaining !== null && /^\d+$/.test(minuteRemaining) && Number(minuteRemaining) === 0) {
      await redis.set(`api-sports:provider:minute-exhausted:${scope}`, '1', { EX: 60 });
    }
    const remaining = response.headers.get('x-ratelimit-requests-remaining');
    if (remaining !== null && /^\d+$/.test(remaining) && Number(remaining) === 0) {
      const now = new Date();
      const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      await redis.set(`api-sports:provider:daily-exhausted:${scope}`, '1', { PX: Math.max(1, reset - now.getTime()) });
    }
    if (response.status !== 429) return;
    const seconds = Number(response.headers.get('retry-after'));
    await redis.set('api-sports:provider:cooldown', '1', { EX: Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60 });
    throw new ServiceUnavailableException('Provedor temporariamente limitado');
  }

  private async redis() {
    if (!process.env.REDIS_URL) throw new ServiceUnavailableException('Redis não configurado');
    if (!this.client) {
      this.client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } });
      this.client.on('error', () => undefined);
    }
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => { this.connecting = undefined; });
      await this.connecting;
    }
    return this.client;
  }

  /** Fresh provider observation for trusted consumers migrating the legacy feed.
   * No caching: a quote or settlement check must not acquire a new timestamp
   * while reusing an older provider response. Hosts and paths are fixed. */
  async providerRead(sport: string, endpoint: string, params: Record<string, unknown>, priorityOverride?: 'interactive' | 'background') {
    const definition = sport === 'football'
      ? { id: 'football', baseUrl: 'https://v3.football.api-sports.io', eventPath: '/fixtures', leaguesSupported: true, oddsSupported: true }
      : apiSportOf(sport);
    if (!definition || ('aliasOf' in definition && definition.aliasOf)) throw new BadRequestException('Modalidade inválida');
    const paths = sport === 'football'
      ? ['/status', '/leagues', '/fixtures', '/predictions', '/odds', '/odds/live']
      : ['/status', ...(definition.leaguesSupported ? ['/leagues'] : []), definition.eventPath, ...(definition.oddsSupported ? ['/odds'] : []), ...(sport === 'basketball' ? ['/players', '/games/statistics/players'] : [])];
    const path = `/${endpoint}`;
    if (!paths.includes(path)) throw new BadRequestException('Consulta não suportada');
    const allowed = new Set(['id', 'ids', 'search', 'country', 'code', 'season', 'current', 'league', 'from', 'to', 'timezone', 'date', 'live', 'fixture', 'bookmaker', 'page', 'game', 'fight', 'team']);
    const url = new URL(path, definition.baseUrl);
    for (const [name, value] of Object.entries(params)) {
      if (!allowed.has(name) || typeof value !== 'string' || value.length > 200 || Array.from({ length: value.length }, (_, i) => value.charCodeAt(i)).some((code) => code < 32 || code === 127)) throw new BadRequestException('Parâmetro inválido');
      url.searchParams.set(name, value);
    }
    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) throw new ServiceUnavailableException('API-Sports não configurada');
    let redis: Awaited<ReturnType<EventsService['redis']>>;
    try { redis = await this.redis(); } catch { throw new ServiceUnavailableException('Redis indisponível'); }
    try {
      await this.checkProviderQuota(redis, definition.id);
      const interactive = path === '/status' || path === '/predictions' ||
        (path === definition.eventPath && Boolean(params.id || params.ids)) ||
        ((path === '/odds' || path === '/odds/live') && Boolean(params.fixture || params.game || params.fight));
      await this.admit(redis, priorityOverride ?? (interactive ? 'interactive' : 'background'), definition.id);
      let response: Response;
      try { response = await fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
      catch { throw new BadGatewayException('Falha ao consultar API-Sports'); }
      await this.observeRateLimit(redis, response, definition.id);
      if (!response.ok) throw new BadGatewayException('API-Sports indisponível');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('response' in body) || !('errors' in body)) throw new BadGatewayException('Resposta inválida da API-Sports');
      // Upstream errors occasionally echo the key. Never forward it to a consumer.
      const safeBody = JSON.parse(JSON.stringify(body, (_name, value: unknown) => typeof value === 'string' ? value.split(apiKey).join('[credencial oculta]') : value)) as unknown;
      const headers: Record<string, string> = {};
      for (const name of ['x-ratelimit-remaining', 'x-ratelimit-limit', 'x-ratelimit-requests-limit', 'x-ratelimit-requests-remaining', 'retry-after']) {
        const value = response.headers.get(name);
        if (value && /^\d+$/.test(value)) headers[name] = value;
      }
      return { body: safeBody, headers };
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Falha na consulta esportiva');
    }
  }

  async basketballPlayerStatistics(gameId: string, priority: 'interactive' | 'background' = 'interactive') {
    if (!/^[1-9]\d{0,14}$/.test(gameId) || !Number.isSafeInteger(Number(gameId))) throw new BadRequestException('Identificador de partida inválido');
    const result = await this.providerRead('basketball', 'games/statistics/players', { id: gameId }, priority);
    const body = result.body as { response?: unknown; errors?: unknown; paging?: { current?: unknown; total?: unknown } };
    if (!Array.isArray(body.response) || (body.errors && Object.keys(body.errors).length > 0) || (body.paging && (Number(body.paging.current) !== 1 || Number(body.paging.total) > 1))) throw new BadGatewayException('Estatísticas de basquete incompletas ou inválidas');
    return { gameId, observedAt: new Date().toISOString(), rows: body.response, settlementReady: false as const };
  }

  async events(sport: string, date: string, priority: 'interactive' | 'background' = 'interactive') {
    const selected = apiSportOf(sport);
    if ((!selected && sport !== 'football') || !isApiSportsDate(date)) throw new BadRequestException('Modalidade ou data inválida');
    const definition = sport === 'football' ? { id: 'football' as const, eventPath: '/fixtures', baseUrl: 'https://v3.football.api-sports.io' } : selected!.aliasOf ? apiSportOf(selected!.aliasOf!)! : selected!;
    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) throw new ServiceUnavailableException('API-Sports não configurada');
    let redis: Awaited<ReturnType<EventsService['redis']>>;
    try { redis = await this.redis(); } catch { throw new ServiceUnavailableException('Redis indisponível'); }
    const cacheKey = `api-sports:events:v1:${definition.id}:${date}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as unknown;
      const token = randomUUID();
      const lock = `${cacheKey}:lock`;
      if (!await redis.set(lock, token, { NX: true, PX: 20_000 })) throw new ServiceUnavailableException('Consulta em andamento; tente novamente');
      try {
        const secondRead = await redis.get(cacheKey);
        if (secondRead) return JSON.parse(secondRead) as unknown;
        await this.checkProviderQuota(redis, definition.id);
        await this.admit(redis, priority, definition.id);
        const url = new URL(definition.eventPath, definition.baseUrl);
        url.searchParams.set('date', date);
        if (definition.id !== 'formula-1' && definition.id !== 'nba') url.searchParams.set('timezone', 'UTC');
        let response: Response;
        try { response = await fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
        catch { throw new BadGatewayException('Falha ao consultar API-Sports'); }
        await this.observeRateLimit(redis, response, definition.id);
        if (!response.ok) throw new BadGatewayException('API-Sports indisponível ou limite atingido');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') throw new BadGatewayException('Resposta inválida da API-Sports');
        const data = body as { response?: unknown; errors?: unknown; paging?: { total?: unknown } };
        if (!Array.isArray(data.response) || (data.errors && Object.keys(data.errors).length > 0) || (typeof data.paging?.total === 'number' && data.paging.total > 1)) throw new BadGatewayException('Resposta incompleta ou com erro da API-Sports');
        const observedAt = new Date();
        const events = data.response.map((item: unknown) => definition.id === 'football' ? normalizeFootballFixture(item, observedAt) : normalizeEvent(definition.id, item, observedAt));
        if (events.some((event) => event === null)) throw new BadGatewayException('Agenda incompleta: evento inválido recebido da API-Sports');
        const result = { sport: definition.id, date, observedAt: observedAt.toISOString(), events };
        const serialized = JSON.stringify(result);
        await redis.set(cacheKey, serialized, { EX: 30 });
        return JSON.parse(serialized) as unknown;
      } finally { await redis.eval(RELEASE, { keys: [lock], arguments: [token] }); }
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Falha no cache esportivo');
    }
  }

  async basketballPlayerMarkets(gameId: string, priority: 'interactive' | 'background' = 'interactive') {
    if (!/^[1-9]\d{0,14}$/.test(gameId) || !Number.isSafeInteger(Number(gameId))) throw new BadRequestException('Identificador de partida inválido');
    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) throw new ServiceUnavailableException('API-Sports não configurada');
    let redis: Awaited<ReturnType<EventsService['redis']>>;
    try { redis = await this.redis(); } catch { throw new ServiceUnavailableException('Redis indisponível'); }
    const key = `api-sports:basketball:player-markets:v2:${gameId}`;
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as unknown;
      const token = randomUUID();
      const lock = `${key}:lock`;
      if (!await redis.set(lock, token, { NX: true, PX: 20_000 })) throw new ServiceUnavailableException('Consulta em andamento; tente novamente');
      try {
        const secondRead = await redis.get(key);
        if (secondRead) return JSON.parse(secondRead) as unknown;
        await this.checkProviderQuota(redis, 'basketball');
        await this.admit(redis, priority, 'basketball');
        const url = new URL('/odds', 'https://v1.basketball.api-sports.io');
        url.searchParams.set('game', gameId);
        let response: Response;
        try { response = await fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
        catch { throw new BadGatewayException('Falha ao consultar API-Sports'); }
        await this.observeRateLimit(redis, response, 'basketball');
        if (!response.ok) throw new BadGatewayException('API-Sports indisponível ou limite atingido');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') throw new BadGatewayException('Resposta inválida da API-Sports');
        const data = body as { response?: unknown; errors?: unknown; paging?: { total?: unknown } };
        if (!Array.isArray(data.response) || (data.errors && Object.keys(data.errors).length > 0) || (typeof data.paging?.total === 'number' && data.paging.total > 1)) throw new BadGatewayException('Resposta incompleta ou com erro da API-Sports');
        if (data.response.some((row: { game?: { id?: unknown } }) => String(row?.game?.id) !== gameId)) throw new BadGatewayException('Resposta não corresponde à partida');
        const result = { gameId, observedAt: new Date().toISOString(), selections: basketballPlayerMarkets(data.response), bettable: false, reason: 'RULES_AND_PRICE_VALIDATION_REQUIRED', combinationPricing: 'UNAVAILABLE' };
        const serialized = JSON.stringify(result);
        await redis.set(key, serialized, { EX: 30 });
        return JSON.parse(serialized) as unknown;
      } finally { await redis.eval(RELEASE, { keys: [lock], arguments: [token] }); }
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Falha no cache esportivo');
    }
  }

  async footballOdds(fixtureId: string, priority: 'interactive' | 'background' = 'interactive') {
    if (!/^[1-9]\d{0,14}$/.test(fixtureId) || !Number.isSafeInteger(Number(fixtureId))) throw new BadRequestException('Identificador de partida inválido');
    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) throw new ServiceUnavailableException('API-Sports não configurada');
    const bookmaker = process.env.FOOTBALL_BOOKMAKER_ID ?? '8';
    if (!/^[1-9]\d{0,8}$/.test(bookmaker)) throw new ServiceUnavailableException('Casa de odds não configurada');
    let redis: Awaited<ReturnType<EventsService['redis']>>;
    try { redis = await this.redis(); } catch { throw new ServiceUnavailableException('Redis indisponível'); }
    const key = `api-sports:football:prematch:v1:${bookmaker}:${fixtureId}`;
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as unknown;
      const token = randomUUID();
      const lock = `${key}:lock`;
      if (!await redis.set(lock, token, { NX: true, PX: 45_000 })) throw new ServiceUnavailableException('Consulta em andamento; tente novamente');
      try {
        const secondRead = await redis.get(key);
        if (secondRead) return JSON.parse(secondRead) as unknown;
        const read = async (path: string, parameters: Record<string, string>) => {
          const url = new URL(path, 'https://v3.football.api-sports.io');
          for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
          for (let attempt = 0; attempt < 2; attempt++) {
            await this.checkProviderQuota(redis, 'football');
            await this.admit(redis, priority, 'football');
            let response: Response;
            try { response = await fetch(url, { headers: { 'x-apisports-key': apiKey }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
            catch { if (attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 100)); continue; } throw new BadGatewayException('Falha ao consultar API-Sports'); }
            await this.observeRateLimit(redis, response, 'football');
            if (response.status >= 500 && attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 100)); continue; }
            if (!response.ok) throw new BadGatewayException('API-Sports indisponível');
            const body: unknown = await response.json();
            if (!body || typeof body !== 'object') throw new BadGatewayException('Resposta inválida da API-Sports');
            const data = body as { response?: unknown; errors?: unknown; paging?: { total?: unknown; current?: unknown } };
            if (!Array.isArray(data.response) || (data.errors && Object.keys(data.errors).length > 0) || (data.paging && (Number(data.paging.total) !== 1 || Number(data.paging.current) !== 1))) throw new BadGatewayException('Resposta incompleta ou com erro da API-Sports');
            return data.response;
          }
          throw new BadGatewayException('Falha ao consultar API-Sports');
        };
        const fixtures = await read('/fixtures', { id: fixtureId });
        if (fixtures.length !== 1 || String(fixtures[0]?.fixture?.id) !== fixtureId) throw new BadGatewayException('Partida não confirmada pelo provedor');
        const fixture = fixtures[0].fixture;
        const status = fixture.status?.short;
        const startsAt = Date.parse(fixture.date);
        const observedAt = new Date().toISOString();
        let selections: ReturnType<typeof mapPrematchOdds> = [];
        let reason = 'MATCH_UNAVAILABLE';
        let providerUpdatedAt: string | null = null;
        if (status === 'NS' && Number.isFinite(startsAt) && startsAt > Date.now()) {
          const rows = await read('/odds', { fixture: fixtureId, bookmaker });
          if (rows.length > 1 || (rows.length === 1 && (String(rows[0]?.fixture?.id) !== fixtureId || !Array.isArray(rows[0]?.bookmakers) || rows[0].bookmakers.length !== 1 || String(rows[0].bookmakers[0]?.id) !== bookmaker || !Array.isArray(rows[0].bookmakers[0]?.bets)))) throw new BadGatewayException('Odds não correspondem à partida ou casa');
          if (rows.length === 1) {
            selections = mapPrematchOdds(rows[0].bookmakers[0].bets);
            const update = Date.parse(rows[0].update);
            if (Number.isFinite(update) && update <= Date.now()) providerUpdatedAt = new Date(update).toISOString();
          }
          reason = selections.length ? 'PREVIEW_ONLY' : 'ODDS_UNAVAILABLE';
        }
        const result = { fixtureId, bookmakerId: Number(bookmaker), status: status ?? null, startTime: Number.isFinite(startsAt) ? new Date(startsAt).toISOString() : null, observedAt, providerUpdatedAt, selections, bettable: false, reason };
        const serialized = JSON.stringify(result);
        await redis.set(key, serialized, { EX: 15 });
        return JSON.parse(serialized) as unknown;
      } finally { await redis.eval(RELEASE, { keys: [lock], arguments: [token] }); }
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Falha no cache esportivo');
    }
  }

  async onApplicationShutdown() { if (this.client?.isOpen) await this.client.close(); }
}
