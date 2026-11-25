import { createHash } from 'crypto';
import {
  ApiSportId,
  apiSportOf,
  namespacedId,
  providerIdOf,
} from './sports-catalog.js';
import { isApiSportsDate } from './provider-date.js';

export interface NormalizedCountry {
  name: string;
  code: string;
  flag: string | null;
}
export interface NormalizedLeague {
  externalId: string;
  providerId: string;
  sportId: ApiSportId;
  name: string;
  type: string;
  logo: string | null;
  country: NormalizedCountry | null;
  /** API basketball uses e.g. 2026-2027. Never coerce it into an integer. */
  season: string | null;
}
export interface NormalizedOpponent {
  id: string | null;
  name: string;
  logo: string | null;
}
export type EventPhase =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'canceled'
  | 'postponed'
  | 'unknown';
export interface NormalizedEvent {
  externalId: string;
  providerId: string;
  sportId: ApiSportId;
  kind: 'match' | 'fight' | 'race';
  name: string;
  startTime: Date;
  league: NormalizedLeague | null;
  country: NormalizedCountry | null;
  home: NormalizedOpponent | null;
  away: NormalizedOpponent | null;
  statusShort: string;
  statusLong: string;
  phase: EventPhase;
  scores: { home: number; away: number } | null;
  /** MMA uses explicit fighter winner flags, never a made-up goal score. */
  winner: 'HOME' | 'AWAY' | null;
  /** Only means the normalized result is unambiguous, not yet confirmed twice. */
  settlementReady: boolean;
  observedAt: Date;
  providerUpdatedAt: Date | null;
}
export interface NormalizedMoneyline {
  type: 'MS_WIN_HOME' | 'MS_WIN_AWAY';
  name: string;
  category: string;
  value: number;
  bookmakerId: number;
  /** Some nonfootball APIs do not provide a source update timestamp. */
  providerUpdatedAt: Date | null;
  observedAt: Date;
}

const textOf = (value: unknown, max = 300): string | null =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max
    ? value.trim()
    : null;

function imageOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

export function normalizeCountry(raw: any): NormalizedCountry | null {
  const name = textOf(raw?.name, 100);
  const code = textOf(raw?.code, 12);
  if (!name) return null;
  return {
    name,
    code:
      code && /^[a-z0-9-]+$/i.test(code)
        ? code.toUpperCase()
        : name
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '-')
            .slice(0, 12),
    flag: imageOf(raw?.flag),
  };
}

function seasonOf(raw: any): string | null {
  const valid = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const season = String(value);
    return /^(?:\d{4}|\d{4}-\d{4})$/.test(season) ? season : null;
  };
  const direct = valid(raw?.season);
  if (direct) return direct;
  if (!Array.isArray(raw?.seasons)) return null;
  const current = raw.seasons.find((entry: any) => entry?.current === true);
  if (current) return valid(current.season ?? current.year);
  const seasons = raw.seasons
    .map((entry: any) =>
      valid(typeof entry === 'object' ? (entry?.season ?? entry?.year) : entry),
    )
    .filter(Boolean);
  seasons.sort();
  return seasons[seasons.length - 1] ?? null;
}

export function normalizeLeague(
  sportId: ApiSportId,
  raw: any,
): NormalizedLeague | null {
  if (!apiSportOf(sportId) || !raw || typeof raw !== 'object') return null;
  const source =
    raw.league && typeof raw.league === 'object' ? raw.league : raw;
  const providerId = providerIdOf(source.id);
  const name = textOf(source.name);
  if (!providerId || !name) return null;
  return {
    externalId: namespacedId(sportId, providerId)!,
    providerId,
    sportId,
    name,
    type: textOf(source.type, 50) ?? 'League',
    logo: imageOf(source.logo),
    country: normalizeCountry(raw.country ?? source.country),
    season: seasonOf(source) ?? seasonOf(raw),
  };
}

/** Only timezone-qualified instants are accepted; local server timezone must
 * never change provider observation or expiry timestamps. */
export function providerInstant(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? new Date(value) : null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return null;
  if (!isApiSportsDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function eventDate(source: any): Date | null {
  const raw =
    typeof source?.date === 'string' ? source.date : source?.date?.start;
  const parsed = raw !== undefined ? providerInstant(raw) : null;
  // An explicitly malformed provider date cannot be rescued by another field.
  if (raw !== undefined && !parsed) return null;
  const timestamp = source?.timestamp ?? source?.date?.timestamp;
  const number =
    typeof timestamp === 'number' ||
    (typeof timestamp === 'string' && /^\d+$/.test(timestamp))
      ? Number(timestamp)
      : NaN;
  const fromTimestamp =
    Number.isSafeInteger(number) && number > 0 ? new Date(number * 1000) : null;
  const validTimestamp =
    fromTimestamp && Number.isFinite(fromTimestamp.getTime())
      ? fromTimestamp
      : null;
  if (
    parsed &&
    validTimestamp &&
    Math.abs(parsed.getTime() - validTimestamp.getTime()) > 60_000
  )
    return null;
  const date = parsed ?? validTimestamp;
  return date && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100
    ? date
    : null;
}

function opponent(raw: any): NormalizedOpponent | null {
  const name = textOf(raw?.name);
  return name
    ? {
        id: providerIdOf(raw?.id),
        name,
        logo: imageOf(raw?.logo ?? raw?.photo),
      }
    : null;
}

function scoreNumber(value: unknown): number | null {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && /^\d+$/.test(value))
  )
    return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 100_000
    ? number
    : null;
}

export function normalizeScores(
  sportId: ApiSportId,
  raw: any,
): { home: number; away: number } | null {
  if (sportId === 'mma' || sportId === 'formula-1') return null;
  const scores = raw?.scores;
  let home: unknown;
  let away: unknown;
  if (sportId === 'nba') {
    home = scores?.home?.points;
    away = scores?.visitors?.points;
  } else if (
    sportId === 'basketball' ||
    sportId === 'baseball' ||
    sportId === 'american-football'
  ) {
    home = scores?.home?.total;
    away = scores?.away?.total;
  } else if (sportId === 'afl') {
    home = scores?.home?.score;
    away = scores?.away?.score;
  } else {
    // Hockey/handball use numeric goals; volleyball uses sets won, not points.
    home = scores?.home;
    away = scores?.away;
  }
  const normalizedHome = scoreNumber(home);
  const normalizedAway = scoreNumber(away);
  return normalizedHome !== null && normalizedAway !== null
    ? { home: normalizedHome, away: normalizedAway }
    : null;
}

function phaseOf(sportId: ApiSportId, short: string, long: string): EventPhase {
  if (['CANC', 'CANCELLED', 'CANCELED', 'ABD'].includes(short))
    return 'canceled';
  if (['POST', 'PST'].includes(short)) return 'postponed';
  if (short === 'NS') return 'scheduled';
  const finished: Partial<Record<ApiSportId, readonly string[]>> = {
    basketball: ['FT', 'AOT'],
    baseball: ['FT'],
    hockey: ['FT', 'AOT', 'AP'],
    handball: ['FT', 'AET'],
    rugby: ['FT', 'AET'],
    volleyball: ['FT'],
    'american-football': ['FT', 'AOT'],
    mma: ['FT'],
    afl: ['FT', 'AOT'],
  };
  if (finished[sportId]?.includes(short)) return 'finished';
  if (sportId === 'formula-1' || sportId === 'nba') {
    const status = long.toLowerCase();
    if (['completed', 'finished'].includes(status)) return 'finished';
    if (['scheduled', 'not started'].includes(status)) return 'scheduled';
    if (['cancelled', 'canceled'].includes(status)) return 'canceled';
    if (status === 'postponed') return 'postponed';
    if (['live', 'in progress', 'in play'].includes(status)) return 'live';
  }
  const live: Partial<Record<ApiSportId, readonly string[]>> = {
    basketball: ['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'BT', 'OT'],
    baseball: ['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9'],
    hockey: ['P1', 'P2', 'P3', 'OT', 'PT', 'BT'],
    handball: ['1H', '2H', 'HT', 'ET', 'BT', 'PT'],
    rugby: ['1H', '2H', 'HT', 'ET', 'BT', 'PT'],
    volleyball: ['S1', 'S2', 'S3', 'S4', 'S5'],
    'american-football': ['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'OT'],
    mma: ['LIVE', 'EOR', 'IN', 'PF', 'WO'],
    afl: ['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'BT', 'OT'],
  };
  return live[sportId]?.includes(short) ? 'live' : 'unknown';
}

function mmaLeague(raw: any, startTime: Date): NormalizedLeague | null {
  const name = textOf(raw?.slug);
  if (!name) return null;
  const providerId = `event-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
  return {
    externalId: `apisports:mma:${providerId}`,
    providerId,
    sportId: 'mma',
    name,
    type: 'Fight event',
    logo: null,
    country: normalizeCountry(raw?.country),
    season: String(startTime.getUTCFullYear()),
  };
}

export function normalizeEvent(
  sportId: ApiSportId,
  raw: any,
  observedAt: Date = new Date(),
): NormalizedEvent | null {
  const definition = apiSportOf(sportId);
  if (
    !definition ||
    !raw ||
    typeof raw !== 'object' ||
    !providerInstant(observedAt)
  )
    return null;
  // AFL wraps only the identifier; its dates/status/scores remain at top level.
  const source =
    sportId === 'american-football'
      ? raw.game
      : sportId === 'afl'
        ? { ...raw, id: raw.game?.id }
        : raw;
  const providerId = providerIdOf(source?.id);
  const startTime = eventDate(source);
  if (!providerId || !startTime) return null;
  const isRace = sportId === 'formula-1';
  const teams =
    sportId === 'mma'
      ? { home: raw.fighters?.first, away: raw.fighters?.second }
      : raw.teams;
  const home = isRace ? null : opponent(teams?.home);
  const away = isRace
    ? null
    : opponent(sportId === 'nba' ? teams?.visitors : teams?.away);
  if (
    !isRace &&
    (!home ||
      !away ||
      (home.id && home.id === away.id) ||
      home.name === away.name)
  )
    return null;
  const statusShort = String(
    source.status?.short ??
      (typeof source.status === 'string' ? source.status : ''),
  )
    .trim()
    .toUpperCase();
  const statusLong =
    textOf(source.status?.long) ??
    textOf(typeof source.status === 'string' ? source.status : '') ??
    statusShort;
  const phase = phaseOf(sportId, statusShort, statusLong);
  const country = normalizeCountry(
    raw.country ??
      raw.league?.country ??
      (isRace ? { name: raw.competition?.location?.country } : null),
  );
  let league =
    sportId === 'mma'
      ? mmaLeague(raw, startTime)
      : normalizeLeague(sportId, raw);
  // AFL's game envelope carries only {id,season}; its public league catalog
  // identifies competition 1 as AFL Premiership.
  if (sportId === 'afl' && !league && providerIdOf(raw.league?.id) === '1') {
    league = normalizeLeague('afl', {
      ...raw.league,
      name: 'AFL Premiership',
      country: { name: 'Australia', code: 'AU' },
    });
  }
  if (isRace)
    league = normalizeLeague(sportId, {
      ...raw.competition,
      season: raw.season,
      type: 'Grand Prix',
      country,
    });
  const scores = normalizeScores(sportId, raw);
  const firstWinner = raw.fighters?.first?.winner;
  const secondWinner = raw.fighters?.second?.winner;
  const winner =
    sportId === 'mma'
      ? firstWinner === true && secondWinner === false
        ? 'HOME'
        : secondWinner === true && firstWinner === false
          ? 'AWAY'
          : null
      : scores && scores.home !== scores.away
        ? scores.home > scores.away
          ? 'HOME'
          : 'AWAY'
        : null;
  const updated = source.update ?? source.updated ?? source.last_update;
  const parsedUpdate = providerInstant(updated);
  const providerUpdatedAt =
    parsedUpdate && parsedUpdate <= observedAt ? parsedUpdate : null;
  const futureObservation = observedAt.getTime() > Date.now() + 1_000;
  return {
    externalId: namespacedId(sportId, providerId)!,
    providerId,
    sportId,
    kind: isRace ? 'race' : sportId === 'mma' ? 'fight' : 'match',
    name: isRace
      ? `${league?.name ?? 'Fórmula 1'} — ${textOf(raw.type, 80) ?? 'Corrida'}`
      : `${home!.name} x ${away!.name}`,
    startTime,
    league,
    country,
    home,
    away,
    statusShort,
    statusLong,
    phase,
    scores,
    winner,
    settlementReady:
      definition.oddsSupported &&
      !definition.aliasOf &&
      phase === 'finished' &&
      startTime <= observedAt &&
      !futureObservation &&
      (updated === undefined || providerUpdatedAt !== null) &&
      (sportId === 'mma' ? winner !== null : scores !== null),
    observedAt: new Date(observedAt),
    providerUpdatedAt,
  };
}

const normalizedLabel = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';

function quoteUnavailable(value: any): boolean {
  if (!value || typeof value !== 'object') return true;
  if (value.active === false || value.isActive === false) return true;
  return ['suspended', 'blocked', 'stopped', 'isSuspended'].some(
    (key) => value[key] !== undefined && value[key] !== false,
  );
}

/** Only whole-game, two-outcome moneyline is imported. Regulation, periods,
 * totals, handicaps and 3-way markets require separate settlement rules. */
export function normalizeMoneyline(
  sportId: ApiSportId,
  raw: any,
  event: NormalizedEvent,
  observedAt: Date = new Date(),
): NormalizedMoneyline[] {
  const definition = apiSportOf(sportId);
  if (
    !definition?.oddsSupported ||
    event?.sportId !== sportId ||
    !event.home ||
    !event.away ||
    event.phase !== 'scheduled' ||
    !(observedAt instanceof Date) ||
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() > Date.now() + 1_000 ||
    event.startTime <= observedAt
  )
    return [];
  const rawId = raw?.[sportId === 'mma' ? 'fight' : 'game']?.id;
  if (providerIdOf(rawId) !== event.providerId) return [];
  if (quoteUnavailable(raw)) return [];
  const embedded = raw?.[sportId === 'mma' ? 'fight' : 'game'];
  // The older APIs embed the event in /odds. Any contradictory status,
  // schedule or opponent identity invalidates that price observation.
  if (embedded?.status !== undefined && embedded.status?.short !== 'NS')
    return [];
  if (embedded?.date !== undefined || embedded?.timestamp !== undefined) {
    const date = eventDate(embedded);
    if (!date || date.getTime() !== event.startTime.getTime()) return [];
  }
  if (embedded?.teams !== undefined) {
    const embeddedHome = opponent(embedded.teams?.home);
    const embeddedAway = opponent(embedded.teams?.away);
    if (
      !embeddedHome ||
      !embeddedAway ||
      embeddedHome.name !== event.home.name ||
      embeddedAway.name !== event.away.name ||
      (event.home.id && embeddedHome.id !== event.home.id) ||
      (event.away.id && embeddedAway.id !== event.away.id)
    )
      return [];
  }
  const rawUpdate = raw?.update ?? raw?.updated ?? raw?.last_update;
  const providerUpdatedAt = providerInstant(rawUpdate);
  // Absence is recorded honestly as null; observation time is a separate clock.
  // A supplied invalid/future timestamp is rejected rather than silently ignored.
  if (
    rawUpdate !== undefined &&
    rawUpdate !== null &&
    (!providerUpdatedAt ||
      providerUpdatedAt > observedAt ||
      observedAt.getTime() - providerUpdatedAt.getTime() >
        definition.oddsRefreshMs! * 2)
  )
    return [];
  if (!Array.isArray(raw?.bookmakers)) return [];
  // Use both selections from one bookmaker and market, never mix prices.
  const bookmakers = [...raw.bookmakers].sort(
    (a, b) => Number(a?.id) - Number(b?.id),
  );
  const acceptedLabels = new Set([
    'home/away',
    'moneyline',
    'money line',
    'winner (including overtime)',
    'home/away (including ot)',
  ]);
  if (sportId === 'mma') acceptedLabels.add('fight winner');
  for (const bookmaker of bookmakers) {
    const bookmakerId = providerIdOf(bookmaker?.id);
    if (
      !bookmakerId ||
      !Array.isArray(bookmaker?.bets) ||
      quoteUnavailable(bookmaker)
    )
      continue;
    for (const market of bookmaker.bets) {
      if (
        !acceptedLabels.has(normalizedLabel(market?.name)) ||
        !Array.isArray(market?.values) ||
        market.values.length !== 2 ||
        quoteUnavailable(market)
      )
        continue;
      const prices = new Map<'HOME' | 'AWAY', number>();
      for (const value of market.values) {
        if (
          quoteUnavailable(value) ||
          (value?.handicap !== undefined && value.handicap !== null)
        )
          continue;
        const label = normalizedLabel(value?.value);
        const side =
          label === 'home' ||
          (sportId === 'mma' && label === normalizedLabel(event.home.name))
            ? 'HOME'
            : label === 'away' ||
                (sportId === 'mma' &&
                  label === normalizedLabel(event.away.name))
              ? 'AWAY'
              : null;
        const price =
          typeof value?.odd === 'number' ||
          (typeof value?.odd === 'string' && /^\d+(?:\.\d+)?$/.test(value.odd))
            ? Number(value.odd)
            : NaN;
        if (
          !side ||
          !Number.isFinite(price) ||
          price <= 1 ||
          price > 10_000 ||
          prices.has(side)
        )
          continue;
        prices.set(side, price);
      }
      if (prices.size !== 2) continue;
      return (['HOME', 'AWAY'] as const).map((side) => ({
        type: side === 'HOME' ? 'MS_WIN_HOME' : 'MS_WIN_AWAY',
        name: side === 'HOME' ? event.home!.name : event.away!.name,
        category: 'Vencedor da partida (inclui prorrogação; empate anula)',
        value: prices.get(side)!,
        bookmakerId: Number(bookmakerId),
        providerUpdatedAt: providerUpdatedAt
          ? new Date(providerUpdatedAt)
          : null,
        observedAt: new Date(observedAt),
      }));
    }
  }
  return [];
}

export { namespacedId } from './sports-catalog.js';
