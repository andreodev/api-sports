import { providerIdOf } from '../multisport/sports-catalog.js';
import { providerInstant } from '../multisport/mapper.js';

/** External IDs remain the numeric strings used in casino-api. */
export function normalizeFootballFixture(raw: any, observedAt: Date) {
  const id = providerIdOf(raw?.fixture?.id);
  const leagueId = providerIdOf(raw?.league?.id);
  const start = providerInstant(raw?.fixture?.date);
  const home = raw?.teams?.home;
  const away = raw?.teams?.away;
  if (!id || !leagueId || !start || typeof home?.name !== 'string' || !home.name.trim() || typeof away?.name !== 'string' || !away.name.trim()) return null;
  return {
    externalId: id,
    league: { externalId: leagueId, name: raw.league.name ?? null, season: raw.league.season ?? null, country: raw.league.country ?? null, logo: raw.league.logo ?? null },
    home: { providerId: providerIdOf(home.id), name: home.name, logo: home.logo ?? null },
    away: { providerId: providerIdOf(away.id), name: away.name, logo: away.logo ?? null },
    startTime: start.toISOString(),
    status: { short: raw.fixture.status?.short ?? null, long: raw.fixture.status?.long ?? null, elapsed: raw.fixture.status?.elapsed ?? null },
    goals: raw.goals ?? null,
    score: raw.score ?? null,
    observedAt: observedAt.toISOString(),
  };
}
