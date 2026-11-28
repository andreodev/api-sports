import { basketballPlayerMarkets } from './basketball-player-markets.js';

it('keeps player markets distinct and does not invent overtime rules', () => {
  const selections = basketballPlayerMarkets([{ update: '2020-01-01T00:00:00Z', bookmakers: [{ id: 4, name: 'Example', bets: [
    { id: 117, name: 'Player Points', values: [{ value: 'Myles Turner - Over 9.5', odd: '1.76' }] },
    { id: 136, name: 'Home Player Rebounds', values: [{ value: 'Myles Turner - Under 5.5', odd: '1.86' }] },
    { id: 118, name: 'Player Assists', values: [{ value: 'Myles Turner - Over 1.5', odd: '1.60' }] },
    { id: 238, name: 'Player Points and Assists', values: [{ value: 'Myles Turner - Over 20.5', odd: '1.90' }] },
    { id: 117, name: 'Player Points', values: [{ value: 'Malformed', odd: '1.5' }] },
  ] }] }]);
  expect(selections.map(({ statistic, side, line }) => ({ statistic, side, line }))).toEqual([
    { statistic: 'points', side: 'over', line: 9.5 },
    { statistic: 'rebounds', side: 'under', line: 5.5 },
    { statistic: 'assists', side: 'over', line: 1.5 },
    { statistic: 'points_assists', side: 'over', line: 20.5 },
  ]);
  expect(selections.every((item) => item.overtimeIncluded === null)).toBe(true);
  expect(selections.every((item) => item.providerUpdatedAt === '2020-01-01T00:00:00.000Z')).toBe(true);
});

it('preserves the provider points milestone as a distinct preview, without treating it as an over bet', () => {
  const rows = basketballPlayerMarkets([{ bookmakers: [{ id: 31, name: 'Example', bets: [{ id: 239, name: 'Player Points Milestones', values: [{ value: 'Example Player - 25', odd: '2.22' }] }] }] }]);
  expect(rows).toMatchObject([{ playerName: 'Example Player', statistic: 'points', side: 'milestone', line: 25, odd: 2.22, overtimeIncluded: null }]);
  expect(basketballPlayerMarkets([{ bookmakers: [{ id: 31, name: 'Example', bets: [{ id: 239, name: 'Unknown market', values: [{ value: 'Example Player - 25', odd: '2.22' }] }] }] }])).toEqual([]);
});

it('does not accept future or invalid provider update times', () => {
  const entry = { bookmakers: [{ id: 4, name: 'Example', bets: [{ id: 117, name: 'Player Points', values: [{ value: 'Player - Over 9.5', odd: '1.76' }] }] }] };
  const selections = basketballPlayerMarkets([{ ...entry, update: '2999-01-01T00:00:00Z' }, { ...entry, update: 'invalid' }, entry]);
  expect(selections.map((item) => item.providerUpdatedAt)).toEqual([null, null, null]);
});

it('reads the Betano "Player Runs" basketball market as player rebounds, and only under that label', () => {
  const bet = (name: string) => basketballPlayerMarkets([{ bookmakers: [{ id: 31, name: 'Betano', bets: [{ id: 240, name, values: [
    { value: 'Nikola Jokic - Over 12.5', odd: '1.85' },
    { value: 'Nikola Jokic - Under 12.5', odd: '1.85' },
  ] }] }] }]);
  expect(bet('Player Runs')).toMatchObject([
    { playerName: 'Nikola Jokic', statistic: 'rebounds', team: null, side: 'over', line: 12.5, odd: 1.85, providerMarketId: 240 },
    { playerName: 'Nikola Jokic', statistic: 'rebounds', team: null, side: 'under', line: 12.5, odd: 1.85, providerMarketId: 240 },
  ]);
  expect(bet('Player Steals')).toEqual([]);
});
