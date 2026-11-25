import { playerStatistics, selectionKey, type BasketballGame } from './basketball-sync.types.js';

const game: BasketballGame = { externalId: 'apisports:basketball:10', providerId: '10', sportId: 'basketball', phase: 'finished', statusShort: 'AOT', startTime: '2026-01-01T00:00:00.000Z', observedAt: '2026-01-01T03:00:00.000Z', league: { providerId: '12', name: 'NBA' }, home: { id: '1', name: 'A' }, away: { id: '2', name: 'B' } };
const row = (player: number, team: number) => ({ game: { id: 10 }, player: { id: player, name: `Player ${player}` }, team: { id: team }, minutes: '15:30', points: 12, rebounds: { total: 4 }, assists: 3 });

describe('basketball observation validation', () => {
  it('preserves identified players and their total statistics including the source observation', () => {
    expect(playerStatistics(game, [row(11, 1), row(12, 2)])).toEqual([
      { playerId: '11', teamId: '1', playerName: 'Player 11', minutes: '15:30', points: 12, rebounds: 4, assists: 3 },
      { playerId: '12', teamId: '2', playerName: 'Player 12', minutes: '15:30', points: 12, rebounds: 4, assists: 3 },
    ]);
  });
  it('rejects partial teams, duplicate identities, invalid game and malformed statistics', () => {
    expect(() => playerStatistics(game, [row(11, 1)])).toThrow();
    expect(() => playerStatistics(game, [row(11, 1), row(11, 2)])).toThrow();
    expect(() => playerStatistics(game, [row(11, 1), { ...row(12, 2), game: { id: 99 } }])).toThrow();
    expect(() => playerStatistics(game, [row(11, 1), { ...row(12, 2), points: -1 }])).toThrow();
  });
  it('does not interpret zero or unknown minutes as a proved void', () => {
    const stats = playerStatistics(game, [{ ...row(11, 1), minutes: '0:00' }, { ...row(12, 2), minutes: null }]);
    expect(stats.map((item) => item.minutes)).toEqual(['0:00', null]);
    expect(stats.every((item) => !('void' in item))).toBe(true);
  });
  it('rejects identity-free player market selections', () => {
    expect(selectionKey({ playerName: '', odd: 1.9 } as never)).toBeNull();
  });
});
