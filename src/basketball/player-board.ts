import { createHash } from 'node:crypto';
import type { PlayerMarketSelection } from '../multisport/basketball-player-markets.js';
import { nameKey } from './player-identity.js';

type Statistic = 'points' | 'rebounds' | 'assists';
type Side = 'over' | 'under' | 'milestone';

export interface BoardPrice {
  bookmakerId: number;
  bookmaker: string;
  providerMarketId: number;
  odd: number;
  providerLabel: string;
  providerUpdatedAt: string | null;
}

/** One pickable line. `selectionId` is stable across reads of the same game, so
 * the frontend can keep it in a slip; it is not a wager identifier. */
export interface BoardSelection {
  selectionId: string;
  statistic: Statistic;
  side: Side;
  line: number;
  bestOdd: number;
  prices: BoardPrice[];
}

export interface BoardStatistics {
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
}

export interface BoardPlayer {
  name: string;
  /** Present only when the bookmaker name matched exactly one player in the
   * game statistics. A name alone is not a reliable identity. */
  playerId: string | null;
  teamId: string | null;
  team: 'home' | 'away' | null;
  statistics: BoardStatistics | null;
  selections: BoardSelection[];
}

interface StatRow { playerId: string; teamId: string; name: string; key: string | null; stats: BoardStatistics }

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : null;
}

/** Lenient on purpose: this feeds a display, not settlement. Malformed rows are
 * dropped instead of failing the whole board. */
export function statRows(rows: unknown, gameId: string): StatRow[] {
  if (!Array.isArray(rows) || rows.length > 200) return [];
  const result: StatRow[] = [];
  for (const row of rows as any[]) {
    const playerId = String(row?.player?.id ?? '');
    const teamId = String(row?.team?.id ?? '');
    const name = row?.player?.name;
    if (String(row?.game?.id ?? '') !== gameId || !/^[1-9]\d{0,14}$/.test(playerId) || !/^[1-9]\d{0,14}$/.test(teamId) ||
      typeof name !== 'string' || !name.trim() || name.length > 150) continue;
    const minutes = typeof row.minutes === 'string' && /^\d{1,3}:[0-5]\d$/.test(row.minutes) ? row.minutes : null;
    result.push({ playerId, teamId, name: name.trim(), key: nameKey(name), stats: { minutes, points: count(row.points), rebounds: count(row.rebounds?.total), assists: count(row.assists) } });
  }
  return new Set(result.map((row) => row.playerId)).size === result.length ? result : [];
}

function selectionId(gameId: string, player: string, statistic: Statistic, side: Side, line: number): string {
  return createHash('sha256').update(JSON.stringify([gameId, player, statistic, side, line])).digest('hex').slice(0, 24);
}

const STAT_ORDER: Record<Statistic, number> = { points: 0, rebounds: 1, assists: 2 };
const SIDE_ORDER: Record<Side, number> = { over: 0, under: 1, milestone: 2 };

/** Groups every player line and price of one game by player, next to the
 * player's game statistics when the provider has them (live or finished). */
export function buildPlayerBoard(gameId: string, selections: PlayerMarketSelection[], rows: unknown): BoardPlayer[] {
  const stats = statRows(rows, gameId);
  const statsByKey = new Map<string, StatRow[]>();
  for (const row of stats) if (row.key) statsByKey.set(row.key, [...(statsByKey.get(row.key) ?? []), row]);

  const players = new Map<string, BoardPlayer & { lines: Map<string, BoardSelection> }>();
  const usedStats = new Set<string>();
  const playerFor = (name: string) => {
    const key = nameKey(name) ?? `raw:${name.trim().toLowerCase()}`;
    let player = players.get(key);
    if (!player) {
      const candidates = statsByKey.get(key) ?? [];
      const match = candidates.length === 1 ? candidates[0] : null;
      if (match) usedStats.add(match.playerId);
      player = { name: match?.name ?? name.trim(), playerId: match?.playerId ?? null, teamId: match?.teamId ?? null, team: null, statistics: match?.stats ?? null, selections: [], lines: new Map() };
      players.set(key, player);
    }
    return { key, player };
  };

  for (const item of Array.isArray(selections) ? selections : []) {
    if (typeof item?.playerName !== 'string' || !item.playerName.trim() || !Number.isFinite(item.line) || !Number.isFinite(item.odd) || item.odd <= 1) continue;
    const { key, player } = playerFor(item.playerName);
    if (item.team && !player.team) player.team = item.team;
    const lineKey = `${item.statistic}|${item.side}|${item.line}`;
    let selection = player.lines.get(lineKey);
    if (!selection) {
      selection = { selectionId: selectionId(gameId, key, item.statistic, item.side, item.line), statistic: item.statistic, side: item.side, line: item.line, bestOdd: item.odd, prices: [] };
      player.lines.set(lineKey, selection);
      player.selections.push(selection);
    }
    // The same bookmaker can repeat a line under two provider markets; keep the first.
    if (selection.prices.some((price) => price.bookmakerId === item.bookmakerId)) continue;
    selection.prices.push({ bookmakerId: item.bookmakerId, bookmaker: item.bookmaker, providerMarketId: item.providerMarketId, odd: item.odd, providerLabel: item.providerLabel, providerUpdatedAt: item.providerUpdatedAt });
    selection.bestOdd = Math.max(selection.bestOdd, item.odd);
  }

  // Players with statistics but no lines still belong on the board.
  for (const row of stats) {
    if (usedStats.has(row.playerId)) continue;
    players.set(`id:${row.playerId}`, { name: row.name, playerId: row.playerId, teamId: row.teamId, team: null, statistics: row.stats, selections: [], lines: new Map() });
  }

  return [...players.values()].map(({ lines: _lines, ...player }) => {
    player.selections.sort((a, b) => STAT_ORDER[a.statistic] - STAT_ORDER[b.statistic] || a.line - b.line || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
    for (const selection of player.selections) selection.prices.sort((a, b) => b.odd - a.odd || a.bookmakerId - b.bookmakerId);
    return player;
  }).sort((a, b) => b.selections.length - a.selections.length || a.name.localeCompare(b.name));
}
