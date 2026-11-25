import { resolvePlayerIdentity, type TeamRoster } from './player-identity.js';

const rosters: TeamRoster[] = [
  { teamId: '1', season: '2026-2027', players: [{ id: 10, name: 'Adebayo Bam' }, { id: 11, name: 'José Silva' }] },
  { teamId: '2', season: '2026-2027', players: [{ id: 20, name: 'Brown Jaylen' }] },
];

it('matches exact name tokens when provider and bookmaker use different order', () => {
  expect(resolvePlayerIdentity('Bam Adebayo', '1', '2', '2026-2027', rosters)).toEqual({ playerId: '10', teamId: '1', rosterName: 'Adebayo Bam' });
  expect(resolvePlayerIdentity('Silva Jose', '1', '2', '2026-2027', rosters)?.playerId).toBe('11');
});

it('refuses incomplete rosters, changed seasons, abbreviations and duplicate names', () => {
  expect(resolvePlayerIdentity('Bam Adebayo', '1', '2', '2026-2027', [rosters[0]])).toBeNull();
  expect(resolvePlayerIdentity('Bam Adebayo', '1', '2', '2025-2026', rosters)).toBeNull();
  expect(resolvePlayerIdentity('B. Adebayo', '1', '2', '2026-2027', rosters)).toBeNull();
  expect(resolvePlayerIdentity('Bam Adebayo', '1', '2', '2026-2027', [rosters[0], { ...rosters[1], players: [...rosters[1].players, { id: 30, name: 'Bam Adebayo' }] }])).toBeNull();
});
