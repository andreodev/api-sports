import type { PlayerMarketSelection } from '../multisport/basketball-player-markets.js';
import { buildPlayerBoard } from './player-board.js';

const sel = (over: Partial<PlayerMarketSelection>): PlayerMarketSelection => ({
  bookmakerId: 1, bookmaker: 'Casa A', providerMarketId: 117, providerMarketName: 'Player Points', playerName: 'Bam Adebayo', team: null,
  statistic: 'points', side: 'over', line: 20.5, odd: 1.8, providerLabel: 'Bam Adebayo - Over 20.5', overtimeIncluded: null, providerUpdatedAt: null, ...over,
});
const stat = (id: number, name: string, team: number, points: number, rebounds: number, assists: number) =>
  ({ game: { id: 99 }, player: { id, name }, team: { id: team }, minutes: '34:12', points, rebounds: { total: rebounds }, assists });

it('groups lines by player and keeps every bookmaker price with the best odd', () => {
  const [player] = buildPlayerBoard('99', [
    sel({}),
    sel({ bookmakerId: 2, bookmaker: 'Casa B', odd: 1.95 }),
    sel({ side: 'under', odd: 1.9 }),
    sel({ statistic: 'rebounds', providerMarketId: 136, team: 'home', line: 8.5, odd: 2.1 }),
  ], []);
  expect(player.name).toBe('Bam Adebayo');
  expect(player.team).toBe('home');
  expect(player.statistics).toBeNull();
  expect(player.selections.map((s) => [s.statistic, s.side, s.line, s.bestOdd])).toEqual([
    ['points', 'over', 20.5, 1.95], ['points', 'under', 20.5, 1.9], ['rebounds', 'over', 8.5, 2.1],
  ]);
  expect(player.selections[0].prices.map((p) => p.bookmaker)).toEqual(['Casa B', 'Casa A']);
});

it('attaches game statistics by exact name tokens, in any order, and lists players without lines', () => {
  const board = buildPlayerBoard('99', [sel({ playerName: 'Adebayo Bam' })], [stat(10, 'Bam Adebayo', 1, 22, 9, 4), stat(11, 'Tyler Herro', 1, 18, 3, 5)]);
  expect(board[0]).toMatchObject({ playerId: '10', teamId: '1', statistics: { points: 22, rebounds: 9, assists: 4, minutes: '34:12' } });
  expect(board[1]).toMatchObject({ name: 'Tyler Herro', playerId: '11', selections: [] });
});

it('keeps selection ids stable across reads and distinct per line', () => {
  const a = buildPlayerBoard('99', [sel({}), sel({ line: 21.5 })], [])[0].selections;
  const b = buildPlayerBoard('99', [sel({ line: 21.5 }), sel({})], [])[0].selections;
  expect(a.map((s) => s.selectionId)).toEqual(b.map((s) => s.selectionId));
  expect(new Set(a.map((s) => s.selectionId)).size).toBe(2);
});

it('does not guess identity when two players share the same name, and ignores rows from other games', () => {
  const board = buildPlayerBoard('99', [sel({})], [stat(10, 'Bam Adebayo', 1, 22, 9, 4), stat(12, 'Adebayo Bam', 2, 3, 1, 0), { ...stat(13, 'Other', 2, 1, 1, 1), game: { id: 5 } }]);
  const withLines = board.find((p) => p.selections.length > 0)!;
  expect(withLines.playerId).toBeNull();
  expect(withLines.statistics).toBeNull();
  expect(board.filter((p) => p.playerId).map((p) => p.playerId).sort()).toEqual(['10', '12']);
});
