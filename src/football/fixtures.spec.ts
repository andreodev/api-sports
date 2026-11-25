import { normalizeFootballFixture } from './fixtures.js';
import { mapApiOdd } from './odds-mapper.js';

it('preserves provider identities and observation time for football', () => {
  const fixture = { fixture: { id: 123, date: '2026-11-19T18:00:00Z', status: { short: 'NS' } }, league: { id: 39, name: 'League' }, teams: { home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' } }, goals: { home: null, away: null } };
  expect(normalizeFootballFixture(fixture, new Date('2026-11-19T17:00:00Z'))).toMatchObject({ externalId: '123', league: { externalId: '39' }, status: { short: 'NS' }, observedAt: '2026-11-19T17:00:00.000Z' });
  expect(normalizeFootballFixture({ ...fixture, fixture: { ...fixture.fixture, date: 'invalid' } }, new Date())).toBeNull();
});

it('retains the original football market mappings', () => {
  expect(mapApiOdd('Match Winner', 'Home')?.type).toBe('HOME_WIN');
  expect(mapApiOdd('Goals Over/Under', 'Over 2.5')?.type).toBe('OVER_2_5');
  expect(mapApiOdd('Double Chance', 'Draw/Away')?.type).toBe('DC_X2');
  expect(mapApiOdd('Corners Over/Under', 'Over 2.5')).toBeNull();
});
