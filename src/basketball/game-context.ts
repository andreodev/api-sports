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
