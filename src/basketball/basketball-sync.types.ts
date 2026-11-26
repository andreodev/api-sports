import { createHash } from 'node:crypto';
import type { PlayerMarketSelection } from '../multisport/basketball-player-markets.js';

export interface BasketballGame {
  externalId: string;
  providerId: string;
  sportId: string;
  phase: string;
  statusShort: string;
  startTime: string;
  observedAt: string;
  league: { providerId: string; name: string } | null;
  home: { id: string | null; name: string } | null;
  away: { id: string | null; name: string } | null;
}

export interface PlayerSnapshot {
  gameId: string;
  observedAt: string;
  bettable: false;
  selections: PlayerMarketSelection[];
}

export interface PlayerStat {
  playerId: string;
  teamId: string;
  playerName: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
}

/** Missing athletes are never interpreted as having not played. */
export function playerStatistics(game: BasketballGame, rows: unknown): PlayerStat[] {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200 || !game.home?.id || !game.away?.id) throw new Error('Estatísticas indisponíveis ou incompletas');
  const teams = new Set([game.home.id, game.away.id]);
  const integer = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1000) throw new Error('Estatística inválida');
    return value;
  };
  const result = rows.map((row: any): PlayerStat => {
    const player = String(row?.player?.id ?? '');
    const team = String(row?.team?.id ?? '');
    const minutes = row?.minutes ?? null;
    if (String(row?.game?.id ?? '') !== game.providerId || !/^[1-9]\d{0,14}$/.test(player) || !Number.isSafeInteger(Number(player)) || !teams.has(team) ||
      typeof row?.player?.name !== 'string' || !row.player.name.trim() || row.player.name.length > 150 ||
      (minutes !== null && (typeof minutes !== 'string' || !/^\d{1,3}:[0-5]\d$/.test(minutes)))) throw new Error('Identidade de jogador inválida');
    return { playerId: player, teamId: team, playerName: row.player.name, minutes, points: integer(row.points), rebounds: integer(row.rebounds?.total), assists: integer(row.assists) };
  });
  if (new Set(result.map((row) => row.playerId)).size !== result.length || teams.size !== 2 || [...teams].some((team) => !result.some((row) => row.teamId === team))) throw new Error('Estatísticas ambíguas ou sem ambos os times');
  return result;
}

export function validGame(value: BasketballGame, now: number): boolean {
  const id = value?.providerId;
  const observed = Date.parse(value?.observedAt);
  const start = Date.parse(value?.startTime);
  const text = (input: unknown, max: number) => typeof input === 'string' && input.trim().length > 0 && input.length <= max;
  return typeof id === 'string' && /^[1-9]\d{0,14}$/.test(id) && Number.isSafeInteger(Number(id)) &&
    value.externalId === `apisports:basketball:${id}` && value.sportId === 'basketball' &&
    ['scheduled', 'live', 'finished', 'canceled', 'postponed', 'unknown'].includes(value.phase) &&
    text(value.statusShort, 32) && Number.isFinite(start) && Number.isFinite(observed) && observed <= now + 5000 &&
    text(value.league?.providerId, 32) && text(value.league?.name, 200) &&
    text(value.home?.id, 32) && text(value.home?.name, 200) && text(value.away?.id, 32) && text(value.away?.name, 200) && value.home?.id !== value.away?.id;
}

/** A provider label is not a player identity. These keys are for preview only. */
export function selectionKey(row: PlayerMarketSelection): string | null {
  if (!Number.isSafeInteger(row?.bookmakerId) || row.bookmakerId <= 0 || !Number.isSafeInteger(row.providerMarketId) || row.providerMarketId <= 0 ||
    typeof row.playerName !== 'string' || !row.playerName.trim() || row.playerName.length > 150 ||
    typeof row.bookmaker !== 'string' || !row.bookmaker.trim() || row.bookmaker.length > 150 ||
    !['points', 'rebounds', 'assists', 'points_assists'].includes(row.statistic) || !['over', 'under', 'milestone'].includes(row.side) ||
    (row.side === 'milestone' && (row.providerMarketId !== 239 || row.statistic !== 'points' || !Number.isSafeInteger(row.line))) ||
    (row.team !== null && row.team !== 'home' && row.team !== 'away') ||
    !Number.isFinite(row.line) || row.line < 0 || !Number.isFinite(row.odd) || row.odd <= 1 || row.odd > 10000) return null;
  return createHash('sha256').update(JSON.stringify([row.bookmakerId, row.providerMarketId, row.playerName, row.team, row.statistic, row.side, row.line])).digest('hex');
}
