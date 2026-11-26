import { parseGameTeams, playerSides } from './game-context.js';

const game = { response: [{ id: 519802, league: { season: '2026-2027' }, teams: {
  home: { id: 156, name: 'Portland Trail Blazers', logo: 'https://media.api-sports.io/basketball/teams/156.png' },
  away: { id: 158, name: 'San Antonio Spurs', logo: 'https://evil.example/158.png' },
} }] };

it('reads both teams and the season, keeping only provider-hosted logos', () => {
  expect(parseGameTeams(game, '519802')).toEqual({ season: '2026-2027', teams: {
    home: { id: '156', name: 'Portland Trail Blazers', logo: 'https://media.api-sports.io/basketball/teams/156.png' },
    away: { id: '158', name: 'San Antonio Spurs', logo: null },
  } });
  expect(parseGameTeams(game, '1')).toBeNull();
  expect(parseGameTeams({ response: [] }, '519802')).toBeNull();
});

it('matches inverted names and drops names listed on both rosters', () => {
  const sides = playerSides(
    { response: [{ name: 'Lillard Damian' }, { name: 'Common Name' }] },
    { response: [{ name: 'Harrison Barnes' }, { name: 'Name Common' }, { name: 'X' }] },
  );
  expect(sides).toEqual({ 'damian lillard': 'home', 'barnes harrison': 'away' });
});
