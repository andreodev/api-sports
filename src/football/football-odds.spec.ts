import { mapPrematchOdds } from './football-odds.js';
import fixture from './__fixtures__/odds-prematch-1641277.json';
import realFixture from './__fixtures__/odds-prematch-real-1557467.json';

it('maps the casino feed and ignores unsupported or invalid prices', () => {
  const bets = fixture.response[0].bookmakers[0].bets;
  const mapped = mapPrematchOdds(bets);
  expect(mapped).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'HOME_WIN', value: 3.6 }), expect.objectContaining({ type: 'DRAW', value: 3.7 })]));
  expect(mapped.some((odd) => odd.type.startsWith('OVER_') || odd.type.startsWith('UNDER_'))).toBe(true);
  expect(mapped.some((odd) => odd.type.startsWith('DC_'))).toBe(true);
  expect(mapPrematchOdds([{ name: 'Both Teams Score', values: [{ value: 'Yes', odd: '1.7' }, { value: 'No', odd: '2.1' }] }]).map((odd) => odd.type)).toEqual(['BTTS_YES', 'BTTS_NO']);
  expect(mapPrematchOdds([{ name: 'Match Winner', values: [{ value: 'Home', odd: 'bad' }] }])).toEqual([]);
  expect(mapPrematchOdds([{ name: 'Match Winner', values: [{ value: 'Home', odd: 1 }, { value: 'Draw', odd: Infinity }, { value: 'Away', odd: -1 }] }])).toEqual([]);
  expect(mapPrematchOdds([])).toEqual([]);
});

it('maps all four groups from the captured provider response', () => {
  const mapped = mapPrematchOdds(realFixture.bookmaker.bets);
  const types = new Set(mapped.map((odd) => odd.type));
  expect(realFixture.fixture.id).toBe(1557467);
  expect(types).toEqual(new Set(['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_1_5', 'UNDER_1_5', 'OVER_2_5', 'UNDER_2_5', 'OVER_3_5', 'UNDER_3_5', 'DC_1X', 'DC_12', 'DC_X2', 'BTTS_YES', 'BTTS_NO']));
});
