import { identifyPlayers, parseGameTeams, playerInitials, playerSides } from './game-context.js';

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
    { response: [{ id: 10, name: 'Lillard Damian' }, { id: 11, name: 'Common Name' }, { id: 'bad', name: 'No Id' }] },
    { response: [{ id: 20, name: 'Harrison Barnes' }, { id: 21, name: 'Name Common' }, { id: 22, name: 'X' }] },
  );
  expect(sides).toEqual({ 'damian lillard': { side: 'home', playerId: '10' }, 'barnes harrison': { side: 'away', playerId: '20' } });
});

it('matches a full name to one roster entry abbreviated to an initial, as in NBL W rosters', () => {
  const home = { response: [{ id: 1, name: 'G. Amoore' }, { id: 2, name: 'T. Key' }, { id: 3, name: 'C. Hodges' }, { id: 4, name: 'Peters Haley' }] };
  const away = { response: [{ id: 5, name: 'Aokuso Zitina' }, { id: 6, name: 'C. Hodges' }, { id: 7, name: 'M. Westbeld' }] };
  const ids = identifyPlayers(
    ['Georgia Amoore', 'Teonni Key', 'Haley Peters', 'Zitina Aokuso', 'Chloe Hodges', 'Maddy Westbeld', 'Unknown Player'],
    playerSides(home, away),
    playerInitials(home, away),
  );
  expect(Object.fromEntries([...ids].map(([name, entry]) => [name, entry.playerId]))).toEqual({
    'Georgia Amoore': '1',
    'Teonni Key': '2',
    'Haley Peters': '4',
    'Zitina Aokuso': '5',
    'Maddy Westbeld': '7',
  });
  expect(ids.get('Georgia Amoore')?.side).toBe('home');
  expect(ids.get('Maddy Westbeld')?.side).toBe('away');
});

it('refuses an initial match when two listed names claim the same player or the name reads two ways', () => {
  const home = { response: [{ id: 1, name: 'G. Amoore' }, { id: 2, name: 'A. Grace' }] };
  const ids = identifyPlayers(['Georgia Amoore', 'Grace Amoore'], playerSides(home, {}), playerInitials(home, {}));
  expect(ids.size).toBe(0);
  const exactWins = identifyPlayers(['Georgia Amoore', 'Amoore Georgia'], playerSides({ response: [{ id: 9, name: 'Georgia Amoore' }] }, {}), playerInitials({ response: [{ id: 9, name: 'Georgia Amoore' }] }, {}));
  expect(exactWins.get('Georgia Amoore')?.playerId).toBe('9');
});
