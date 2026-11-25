import samples from './__fixtures__/provider-samples.json';
import { API_SPORTS_CATALOG, namespacedId } from './sports-catalog.js';
import {
  normalizeEvent,
  normalizeLeague,
  normalizeMoneyline,
  normalizeScores,
} from './mapper.js';

const observedAt = new Date('2026-10-29T12:00:00Z');
const game = () => ({
  id: 77,
  date: '2026-10-29T20:00:00Z',
  status: { short: 'NS', long: 'Not Started' },
  country: { name: 'USA', code: 'US' },
  league: { id: 12, name: 'NBA', season: '2026-2027' },
  teams: {
    home: { id: 1, name: 'Home Team' },
    away: { id: 2, name: 'Away Team' },
  },
  scores: { home: { total: null }, away: { total: null } },
});
const odds = () => ({
  game: { id: 77 },
  update: '2026-10-29T08:00:00Z',
  bookmakers: [
    {
      id: 8,
      bets: [
        {
          name: 'Home/Away',
          values: [
            { value: 'Home', odd: '1.90' },
            { value: 'Away', odd: '2.10' },
          ],
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(observedAt);
});
afterEach(() => vi.useRealTimers());

describe('multi-sport identity and capabilities', () => {
  it('does not expose in-play capability and keeps NBA as a basketball alias', () => {
    expect(API_SPORTS_CATALOG).toHaveLength(11);
    expect(
      API_SPORTS_CATALOG.every((sport) => sport.liveOddsSupported === false),
    ).toBe(true);
    expect(
      API_SPORTS_CATALOG.find((sport) => sport.id === 'nba'),
    ).toMatchObject({ aliasOf: 'basketball', oddsSupported: false });
    expect(
      API_SPORTS_CATALOG.find((sport) => sport.id === 'formula-1'),
    ).toMatchObject({ oddsSupported: false, eventPath: '/races' });
  });

  it('separates IDs across provider APIs and rejects malformed identifiers', () => {
    expect(namespacedId('basketball', 77)).toBe('apisports:basketball:77');
    expect(namespacedId('baseball', 77)).toBe('apisports:baseball:77');
    for (const value of [
      null,
      '',
      false,
      0,
      -1,
      1.2,
      '77/../../status',
      '1e3',
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(namespacedId('mma', value)).toBeNull();
  });

  it('preserves season ranges and recognizes wrapped NFL league envelopes', () => {
    expect(
      normalizeLeague('basketball', {
        id: 12,
        name: 'NBA',
        seasons: [
          { season: '2025-2026' },
          { season: '2026-2027', current: true },
        ],
      }),
    ).toMatchObject({
      externalId: 'apisports:basketball:12',
      season: '2026-2027',
    });
    expect(
      normalizeLeague('american-football', {
        league: { id: 1, name: 'NFL' },
        country: { name: 'USA', code: 'US' },
        seasons: [2025, 2026],
      }),
    ).toMatchObject({
      providerId: '1',
      season: '2026',
      country: { code: 'US' },
    });
  });
});

describe('provider event normalization', () => {
  it('normalizes scheduled basketball without inventing an unknown score', () => {
    expect(normalizeEvent('basketball', game(), observedAt)).toMatchObject({
      externalId: 'apisports:basketball:77',
      phase: 'scheduled',
      scores: null,
      settlementReady: false,
      league: { season: '2026-2027' },
    });
  });

  it.each([
    null,
    false,
    '',
    'unknown',
    '2026-02-30T20:00:00Z',
    '2026-10-29 20:00:00',
  ])('rejects invalid or timezone-ambiguous start date %p', (date) => {
    expect(
      normalizeEvent('basketball', { ...game(), date }, observedAt),
    ).toBeNull();
  });

  it('rejects contradictory date/timestamp and identical opponents', () => {
    expect(
      normalizeEvent(
        'basketball',
        { ...game(), timestamp: observedAt.getTime() / 1000 },
        observedAt,
      ),
    ).toBeNull();
    const raw = game();
    raw.teams.away = raw.teams.home;
    expect(normalizeEvent('basketball', raw, observedAt)).toBeNull();
  });

  it('normalizes wrapped NFL timestamps and quarter scores', () => {
    const raw = {
      ...game(),
      game: {
        id: 77,
        date: { timestamp: 1793260800 },
        status: { short: 'Q3', long: 'Third Quarter' },
      },
      scores: { home: { total: 21 }, away: { total: 7 } },
    };
    expect(normalizeEvent('american-football', raw, observedAt)).toMatchObject({
      phase: 'live',
      scores: { home: 21, away: 7 },
      settlementReady: false,
    });
  });

  it('uses baseball runs and volleyball sets, never null/false coerced to zero', () => {
    expect(
      normalizeScores('baseball', {
        scores: { home: { total: 5, hits: 7 }, away: { total: 4, hits: 10 } },
      }),
    ).toEqual({ home: 5, away: 4 });
    expect(
      normalizeScores('volleyball', { scores: { home: 3, away: 2 } }),
    ).toEqual({ home: 3, away: 2 });
    expect(
      normalizeScores('hockey', { scores: { home: null, away: 0 } }),
    ).toBeNull();
    expect(
      normalizeScores('handball', { scores: { home: false, away: 0 } }),
    ).toBeNull();
  });

  it('requires an actual final status, valid scores and a nonfuture result before settlement', () => {
    const raw = {
      ...game(),
      date: '2026-10-28T20:00:00Z',
      status: { short: 'FT' },
      scores: { home: { total: 105 }, away: { total: 100 } },
    };
    expect(normalizeEvent('basketball', raw, observedAt)).toMatchObject({
      phase: 'finished',
      settlementReady: true,
      scores: { home: 105, away: 100 },
    });
    expect(
      normalizeEvent(
        'basketball',
        { ...raw, status: { short: 'AWD' } },
        observedAt,
      )?.settlementReady,
    ).toBe(false);
    expect(
      normalizeEvent(
        'basketball',
        { ...raw, update: '2026-10-30T00:00:00Z' },
        observedAt,
      )?.settlementReady,
    ).toBe(false);
    expect(
      normalizeEvent(
        'basketball',
        { ...raw, date: '2026-10-30T00:00:00Z' },
        observedAt,
      )?.settlementReady,
    ).toBe(false);
  });

  it('uses explicit MMA winner flags and retains ambiguous fight results for review', () => {
    const raw = {
      id: 55,
      date: '2026-10-28T20:00:00Z',
      slug: 'UFC Fight Night',
      status: { short: 'FT' },
      fighters: {
        first: { id: 1, name: 'A', winner: true },
        second: { id: 2, name: 'B', winner: false },
      },
    };
    expect(normalizeEvent('mma', raw, observedAt)).toMatchObject({
      kind: 'fight',
      winner: 'HOME',
      scores: null,
      settlementReady: true,
      league: { name: 'UFC Fight Night' },
    });
    raw.fighters.second.winner = true;
    expect(normalizeEvent('mma', raw, observedAt)).toMatchObject({
      winner: null,
      scores: null,
      settlementReady: false,
    });
  });

  it('normalizes F1 races without invented opponents or betting scores', () => {
    const raw = {
      id: 44,
      date: '2026-10-30T20:00:00Z',
      season: 2026,
      competition: {
        id: 8,
        name: 'Brazil Grand Prix',
        location: { country: 'Brazil' },
      },
      type: 'Race',
      status: 'Scheduled',
    };
    expect(normalizeEvent('formula-1', raw, observedAt)).toMatchObject({
      kind: 'race',
      phase: 'scheduled',
      home: null,
      away: null,
      scores: null,
      settlementReady: false,
    });
  });
});

describe('moneyline import safety', () => {
  it('imports two selections from a single explicit full-game market', () => {
    const event = normalizeEvent('basketball', game(), observedAt);
    expect(normalizeMoneyline('basketball', odds(), event, observedAt)).toEqual(
      [
        expect.objectContaining({
          type: 'MS_WIN_HOME',
          value: 1.9,
          bookmakerId: 8,
          providerUpdatedAt: new Date('2026-10-29T08:00:00Z'),
        }),
        expect.objectContaining({
          type: 'MS_WIN_AWAY',
          value: 2.1,
          bookmakerId: 8,
        }),
      ],
    );
  });

  it.each([
    '3Way Result',
    'Home/Away - 1st Half',
    'Home/Away (Reg Time)',
    'Home/Away (1st Period)',
    'Match Winner',
    'Asian Handicap',
  ])('does not infer rules for unsupported %s markets', (name) => {
    const raw = odds();
    raw.bookmakers[0].bets[0].name = name;
    expect(
      normalizeMoneyline(
        'basketball',
        raw,
        normalizeEvent('basketball', game(), observedAt),
        observedAt,
      ),
    ).toEqual([]);
  });

  it.each([
    'invalid',
    '2026-10-29T13:00:00Z',
    '2026-10-26T08:00:00Z',
    '2026-10-29 08:00:00',
  ])(
    'blocks supplied future, stale or ambiguous provider update %p',
    (update) => {
      expect(
        normalizeMoneyline(
          'basketball',
          { ...odds(), update },
          normalizeEvent('basketball', game(), observedAt),
          observedAt,
        ),
      ).toEqual([]);
    },
  );

  it('keeps a missing source update null and never substitutes observation time', () => {
    const raw = odds();
    delete raw.update;
    expect(
      normalizeMoneyline(
        'basketball',
        raw,
        normalizeEvent('basketball', game(), observedAt),
        observedAt,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'MS_WIN_HOME',
        providerUpdatedAt: null,
        observedAt,
      }),
      expect.objectContaining({
        type: 'MS_WIN_AWAY',
        providerUpdatedAt: null,
        observedAt,
      }),
    ]);
  });

  it('blocks wrong game identities, live events, closed markets and incomplete pairs', () => {
    const event = normalizeEvent('basketball', game(), observedAt);
    expect(
      normalizeMoneyline(
        'basketball',
        { ...odds(), game: { id: 88 } },
        event,
        observedAt,
      ),
    ).toEqual([]);
    expect(
      normalizeMoneyline(
        'basketball',
        odds(),
        { ...event, phase: 'live' },
        observedAt,
      ),
    ).toEqual([]);
    const raw: any = odds();
    raw.bookmakers[0].bets[0].values[1].suspended = true;
    expect(normalizeMoneyline('basketball', raw, event, observedAt)).toEqual(
      [],
    );
    raw.bookmakers[0].bets[0].values.pop();
    expect(normalizeMoneyline('basketball', raw, event, observedAt)).toEqual(
      [],
    );
  });

  it('does not combine different bookmakers or retain invalid odds', () => {
    const raw: any = odds();
    raw.bookmakers.push({
      id: 9,
      bets: [{ name: 'Home/Away', values: [{ value: 'Away', odd: '2.00' }] }],
    });
    raw.bookmakers[0].bets[0].values[1].odd = 'NaN';
    expect(
      normalizeMoneyline(
        'basketball',
        raw,
        normalizeEvent('basketball', game(), observedAt),
        observedAt,
      ),
    ).toEqual([]);
  });

  it('rejects contradictory embedded fixture proof and nonboolean suspension flags', () => {
    const event = normalizeEvent('basketball', game(), observedAt);
    expect(
      normalizeMoneyline(
        'basketball',
        { ...odds(), game: { ...game(), status: { short: 'Q1' } } },
        event,
        observedAt,
      ),
    ).toEqual([]);
    const changed = game();
    changed.teams.home.name = 'Different Team';
    expect(
      normalizeMoneyline(
        'basketball',
        { ...odds(), game: changed },
        event,
        observedAt,
      ),
    ).toEqual([]);
    const raw: any = odds();
    raw.bookmakers[0].bets[0].values[0].suspended = 'true';
    expect(normalizeMoneyline('basketball', raw, event, observedAt)).toEqual(
      [],
    );
  });
});

describe('public API-Sports samples collected on 2026-10-29', () => {
  const fixture = samples;
  const sampledAt = new Date(fixture.observedAt);

  beforeEach(() => vi.setSystemTime(sampledAt));

  it.each(API_SPORTS_CATALOG.map((entry) => entry.id))(
    'normalizes the actual %s event envelope',
    (sportId) => {
      const event = normalizeEvent(
        sportId,
        fixture.sports[sportId].event,
        sampledAt,
      );
      expect(event).not.toBeNull();
      expect(event.externalId).toContain(`apisports:${sportId}:`);
      if (sportId === 'afl')
        expect(event).toMatchObject({
          phase: 'finished',
          scores: { home: 132, away: 69 },
          league: { name: 'AFL Premiership', season: '2026' },
        });
      if (sportId === 'formula-1')
        expect(event).toMatchObject({
          kind: 'race',
          name: 'Mexico Grand Prix — Race',
          home: null,
          away: null,
        });
    },
  );

  it.each(['basketball', 'hockey'] as const)(
    'imports actual %s moneyline without fabricating a source update',
    (sportId) => {
      const sample = fixture.sports[sportId];
      const event = normalizeEvent(sportId, sample.event, sampledAt);
      const prices = normalizeMoneyline(sportId, sample.odds, event, sampledAt);
      expect(prices).toHaveLength(2);
      expect(prices.every((price) => price.providerUpdatedAt === null)).toBe(
        true,
      );
      expect(prices.map((price) => price.type)).toEqual([
        'MS_WIN_HOME',
        'MS_WIN_AWAY',
      ]);
    },
  );

  it('rejects the stale NFL source update and odds belonging to another MMA fight', () => {
    const nfl = fixture.sports['american-football'];
    const prices = normalizeMoneyline(
      'american-football',
      nfl.odds,
      normalizeEvent('american-football', nfl.event, sampledAt),
      sampledAt,
    );
    expect(prices).toEqual([]);
    const mma = fixture.sports.mma;
    expect(
      normalizeMoneyline(
        'mma',
        mma.oddsWithDifferentFight,
        normalizeEvent('mma', mma.event, sampledAt),
        sampledAt,
      ),
    ).toEqual([]);
  });
});
