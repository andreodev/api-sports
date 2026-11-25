export interface RosterPlayer { id: number | string; name: string }
export interface TeamRoster { teamId: string; season: string; players: RosterPlayer[] }

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value));
}

/** The provider may invert first and last names. This is exact token matching,
 * not fuzzy matching: missing initials, suffixes or collisions remain unresolved. */
export function nameKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 150) return null;
  const tokens = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 10) return null;
  return tokens.sort().join(' ');
}

/** Returns only an unambiguous ID within both complete, explicitly named team
 * rosters. A roster match is not proof of current participation or a wager. */
export function resolvePlayerIdentity(name: string, homeId: string, awayId: string, season: string, rosters: TeamRoster[]) {
  const wanted = nameKey(name);
  if (!wanted || !validId(homeId) || !validId(awayId) || homeId === awayId || !/^\d{4}(?:-\d{4})?$/.test(season) || !Array.isArray(rosters) || rosters.length !== 2) return null;
  if (new Set(rosters.map((roster) => roster.teamId)).size !== 2 || ![homeId, awayId].every((team) => rosters.some((roster) => roster.teamId === team))) return null;
  const matches: { playerId: string; teamId: string; rosterName: string }[] = [];
  for (const roster of rosters) {
    if (roster.season !== season || !Array.isArray(roster.players) || roster.players.length === 0 || roster.players.length > 1000) return null;
    for (const player of roster.players) {
      const playerId = String(player?.id ?? '');
      if (!validId(playerId) || !nameKey(player?.name)) return null;
      if (nameKey(player.name) === wanted) matches.push({ playerId, teamId: roster.teamId, rosterName: player.name });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
