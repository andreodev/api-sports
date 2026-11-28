import { nameKey } from './player-identity.js';

export interface GameTeam { id: string; name: string; logo: string | null }
export interface GameTeams { home: GameTeam; away: GameTeam }

const ID = /^[1-9]\d{0,14}$/;
const LOGO = /^https:\/\/media\.api-sports\.io\/[\w./-]{1,200}\.(?:png|svg)$/;

function team(value: any): GameTeam | null {
  const id = String(value?.id ?? '');
  if (!ID.test(id) || typeof value?.name !== 'string' || !value.name.trim() || value.name.length > 150) return null;
  return { id, name: value.name.trim(), logo: typeof value.logo === 'string' && LOGO.test(value.logo) ? value.logo : null };
}

/** Reads teams and season from a provider `/games?id=` body for one game. */
export function parseGameTeams(body: unknown, gameId: string): { teams: GameTeams; season: string } | null {
  const rows = (body as { response?: unknown })?.response;
  if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0]?.id) !== gameId) return null;
  const home = team(rows[0].teams?.home);
  const away = team(rows[0].teams?.away);
  const season = String(rows[0].league?.season ?? '');
  if (!home || !away || home.id === away.id || !/^\d{4}(?:-\d{4})?$/.test(season)) return null;
  return { teams: { home, away }, season };
}

export interface RosterEntry { side: 'home' | 'away'; playerId: string }

/** Maps a normalized player name to the side and provider player ID of the one
 * roster entry carrying it. Names found on both rosters, or twice on one, are
 * left out: a name alone is not an identity. */
export function playerSides(homeRoster: unknown, awayRoster: unknown): Record<string, RosterEntry> {
  const seen = new Map<string, RosterEntry | null>();
  for (const [side, roster] of [['home', homeRoster], ['away', awayRoster]] as const) {
    const players = (roster as { response?: unknown })?.response;
    if (!Array.isArray(players) || players.length > 1000) continue;
    for (const player of players) {
      const key = nameKey(player?.name);
      const playerId = String(player?.id ?? '');
      if (!key || !ID.test(playerId)) continue;
      seen.set(key, seen.has(key) ? null : { side, playerId });
    }
  }
  const result: Record<string, RosterEntry> = {};
  for (const [key, entry] of seen) if (entry) result[key] = entry;
  return result;
}

function tokens(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length > 150) return null;
  const list = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return list.length >= 2 && list.length <= 10 ? list : null;
}

/** Key of a roster name written with one first-name initial, such as
 * "G. Amoore": the initial, then the other name tokens in sorted order. */
export function initialKey(value: unknown): string | null {
  const list = tokens(value);
  if (!list) return null;
  const initials = list.filter((token) => token.length === 1);
  const rest = list.filter((token) => token.length > 1);
  return initials.length === 1 && rest.length >= 1 ? `${initials[0]} ${rest.sort().join(' ')}` : null;
}

/** Like playerSides, for roster names abbreviated to one initial. A key
 * found twice (even on different teams) is left out. */
export function playerInitials(homeRoster: unknown, awayRoster: unknown): Record<string, RosterEntry> {
  const seen = new Map<string, RosterEntry | null>();
  for (const [side, roster] of [['home', homeRoster], ['away', awayRoster]] as const) {
    const players = (roster as { response?: unknown })?.response;
    if (!Array.isArray(players) || players.length > 1000) continue;
    for (const player of players) {
      const key = initialKey(player?.name);
      const playerId = String(player?.id ?? '');
      if (!key || !ID.test(playerId)) continue;
      seen.set(key, seen.has(key) ? null : { side, playerId });
    }
  }
  const result: Record<string, RosterEntry> = {};
  for (const [key, entry] of seen) if (entry) result[key] = entry;
  return result;
}

/** Roster entry of each full player name. An exact name wins. Otherwise a
 * name such as "Georgia Amoore" matches the one roster entry "G. Amoore",
 * only if no other reading of the name points elsewhere and no other name in
 * the list claims the same player. Anything ambiguous stays unidentified. */
export function identifyPlayers(
  names: string[],
  sides: Record<string, RosterEntry>,
  initials: Record<string, RosterEntry> = {},
): Map<string, RosterEntry> {
  const exact = new Map<string, RosterEntry>();
  const abbreviated = new Map<string, RosterEntry>();
  // Every player a name could be, even when the name itself is ambiguous.
  const claims = new Map<string, number>();
  const claim = (playerId: string) => claims.set(playerId, (claims.get(playerId) ?? 0) + 1);
  for (const name of new Set(names)) {
    const key = nameKey(name);
    if (key && sides[key]) {
      exact.set(name, sides[key]);
      claim(sides[key].playerId);
      continue;
    }
    const list = tokens(name);
    if (!list || list.some((token) => token.length < 2)) continue;
    const found = new Map<string, RosterEntry>();
    list.forEach((first, index) => {
      const others = list.filter((_, i) => i !== index).sort().join(' ');
      const entry = initials[`${first[0]} ${others}`];
      if (entry) found.set(entry.playerId, entry);
    });
    found.forEach((_, playerId) => claim(playerId));
    if (found.size === 1) abbreviated.set(name, [...found.values()][0]);
  }
  const result = new Map(exact);
  for (const [name, entry] of abbreviated)
    if (claims.get(entry.playerId) === 1) result.set(name, entry);
  return result;
}
