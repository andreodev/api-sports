/** Provider market IDs verified against basketball /bets. Do not infer rules
 * such as overtime inclusion from an unqualified provider label. */
/** `points_assists` is the combined total (points + assists) of one player. */
export type PlayerStatistic = 'points' | 'assists' | 'rebounds' | 'points_assists';

/** `name` pins a market whose provider label does not describe it, so a reused
 * ID never prices a different statistic. */
const MARKETS = new Map<number, { statistic: PlayerStatistic; team: 'home' | 'away' | null; milestone?: boolean; name?: string }>([
  [117, { statistic: 'points', team: null }],
  [118, { statistic: 'assists', team: null }],
  [132, { statistic: 'assists', team: 'home' }],
  [133, { statistic: 'assists', team: 'away' }],
  [135, { statistic: 'rebounds', team: 'away' }],
  [136, { statistic: 'rebounds', team: 'home' }],
  [238, { statistic: 'points_assists', team: null }],
  [239, { statistic: 'points', team: null, milestone: true, name: 'player points milestones' }],
  // Betano publishes NBA player rebounds under this baseball label. Its lines
  // are rebound totals: the highest belong to Jokic, Wembanyama, Towns, Gobert.
  [240, { statistic: 'rebounds', team: null, name: 'player runs' }],
]);

export interface PlayerMarketSelection {
  bookmakerId: number;
  bookmaker: string;
  providerMarketId: number;
  providerMarketName: string;
  playerName: string;
  team: 'home' | 'away' | null;
  statistic: PlayerStatistic;
  side: 'over' | 'under' | 'milestone';
  line: number;
  odd: number;
  providerLabel: string;
  overtimeIncluded: null;
  providerUpdatedAt: string | null;
}

export function basketballPlayerMarkets(data: unknown): PlayerMarketSelection[] {
  if (!Array.isArray(data)) return [];
  const result: PlayerMarketSelection[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.bookmakers)) continue;
    const updatedAt = typeof entry.update === 'string' ? Date.parse(entry.update) : NaN;
    const providerUpdatedAt = Number.isFinite(updatedAt) && updatedAt <= Date.now() ? new Date(updatedAt).toISOString() : null;
    for (const bookmaker of entry.bookmakers) {
      if (!Number.isSafeInteger(bookmaker?.id) || bookmaker.id <= 0 || typeof bookmaker.name !== 'string' || !Array.isArray(bookmaker.bets)) continue;
      for (const bet of bookmaker.bets) {
        const definition = MARKETS.get(bet?.id);
        if (!definition || typeof bet.name !== 'string' || !Array.isArray(bet.values)) continue;
        if (definition.name && bet.name.trim().toLowerCase() !== definition.name) continue;
        for (const value of bet.values) {
          if (typeof value?.value !== 'string' || value.value.length > 300) continue;
          const match = definition.milestone
            ? /^(.+?)\s+-\s+(\d+)$/.exec(value.value)
            : /^(.+?)\s+-\s+(Over|Under)\s+(\d+(?:\.\d+)?)$/i.exec(value.value);
          if (!match) continue;
          const line = Number(definition.milestone ? match[2] : match[3]);
          const odd = typeof value.odd === 'string' || typeof value.odd === 'number' ? Number(value.odd) : NaN;
          if (!match[1].trim() || !Number.isFinite(line) || line < 0 || !Number.isFinite(odd) || odd <= 1 || odd > 10_000) continue;
          result.push({ bookmakerId: bookmaker.id, bookmaker: bookmaker.name, providerMarketId: bet.id, providerMarketName: bet.name, playerName: match[1].trim(), statistic: definition.statistic, team: definition.team, side: definition.milestone ? 'milestone' : match[2].toLowerCase() as 'over' | 'under', line, odd, providerLabel: value.value, overtimeIncluded: null, providerUpdatedAt });
        }
      }
    }
  }
  return result;
}
