import { CentralPreview } from './central-preview';

const makeLocal = () =>
  ({
    serverTime: new Date().toISOString(),
    match: {
      id: 'local-match',
      status: 'UPCOMING',
      startTime: '2099-01-01T00:00:00.000Z',
      bettable: true,
      odds: [{ id: 'local-odd', type: 'HOME_WIN', value: 1.5, isActive: true }],
    },
    page: {
      builderEnabled: true,
      suspended: false,
      markets: [
        {
          suspended: false,
          lines: [
            {
              outcomes: [
                {
                  id: 'local-odd',
                  type: 'HOME_WIN',
                  value: 1.5,
                  isActive: true,
                  suspended: false,
                },
              ],
            },
          ],
        },
      ],
    },
  }) as any;

describe('central preview', () => {
  const previous = {
    enabled: process.env.SPORTS_PREVIEW_ENABLED,
    url: process.env.SPORTS_PREVIEW_URL,
    key: process.env.SPORTS_PREVIEW_KEY,
    fetch: global.fetch,
  };
  beforeEach(() => {
    process.env.SPORTS_PREVIEW_ENABLED = 'true';
    process.env.SPORTS_PREVIEW_URL = 'http://sports';
    process.env.SPORTS_PREVIEW_KEY = 'local-test-only';
  });
  afterEach(() => {
    if (previous.enabled === undefined)
      delete process.env.SPORTS_PREVIEW_ENABLED;
    else process.env.SPORTS_PREVIEW_ENABLED = previous.enabled;
    if (previous.url === undefined) delete process.env.SPORTS_PREVIEW_URL;
    else process.env.SPORTS_PREVIEW_URL = previous.url;
    if (previous.key === undefined) delete process.env.SPORTS_PREVIEW_KEY;
    else process.env.SPORTS_PREVIEW_KEY = previous.key;
    global.fetch = previous.fetch;
  });
  it('keeps local UUIDs and locks every selection', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          fixtureId: '123',
          status: 'NS',
          startTime: '2099-01-01T00:00:00.000Z',
          bettable: false,
          selections: [
            {
              selection_type: 'HOME_WIN',
              price: '2.10',
              bettable: false,
              unavailable: false,
              expires_at: new Date(Date.now() + 30000).toISOString(),
            },
          ],
        }),
      });
    const result = await new CentralPreview().apply(makeLocal(), '123');
    expect(result.match).toMatchObject({
      id: 'local-match',
      bettable: false,
      odds: [{ id: 'local-odd', value: 2.1, isActive: false }],
    });
    expect(result.page.markets[0].lines[0].outcomes[0]).toMatchObject({
      id: 'local-odd',
      isActive: false,
      suspended: true,
    });
  });
  it('fails closed on an inconsistent response or network failure', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          fixtureId: '999',
          status: 'NS',
          bettable: false,
          selections: [],
        }),
      });
    const result = await new CentralPreview().apply(makeLocal(), '123');
    expect(result.match).toMatchObject({
      bettable: false,
      odds: [{ id: 'local-odd', value: 1.5, isActive: false }],
    });
  });
  it('keeps the original response when preview is disabled', async () => {
    process.env.SPORTS_PREVIEW_ENABLED = 'false';
    const local = makeLocal();
    expect(await new CentralPreview().apply(local, '123')).toBe(local);
  });
});
