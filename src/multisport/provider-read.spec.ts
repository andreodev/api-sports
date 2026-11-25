import { EventsService } from './events.service.js';

describe('fresh provider reads', () => {
  const originalKey = process.env.API_SPORTS_KEY;
  beforeEach(() => { process.env.API_SPORTS_KEY = 'provider-secret'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.API_SPORTS_KEY;
    else process.env.API_SPORTS_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  function service() {
    const events = new EventsService();
    const redis = { get: vi.fn().mockResolvedValue(null), eval: vi.fn().mockResolvedValue(1), set: vi.fn() };
    vi.spyOn(events as any, 'redis').mockResolvedValue(redis);
    return { events, redis };
  }

  it('sends authorized requests to fixed provider hosts without caching and retains rate headers', async () => {
    const { events, redis } = service();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ errors: [], response: [{ fixture: { id: 123 } }], paging: { current: 1, total: 1 } }), { headers: { 'x-ratelimit-remaining': '20' } }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await events.providerRead('football', 'fixtures', { id: '123', timezone: 'UTC' });
    await events.providerRead('football', 'fixtures', { id: '123', timezone: 'UTC' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://v3.football.api-sports.io/fixtures?id=123&timezone=UTC');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { 'x-apisports-key': 'provider-secret' }, redirect: 'error' });
    expect(first.headers).toEqual({ 'x-ratelimit-remaining': '20' });
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it('rejects unrecognized sports, endpoints and query parameters without making a request', async () => {
    const { events } = service();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(events.providerRead('football', '../status', {})).rejects.toThrow();
    await expect(events.providerRead('football', 'fixtures', { url: 'http://example.com' })).rejects.toThrow();
    await expect(events.providerRead('invalid', 'status', {})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on quota errors, malformed responses and provider failures', async () => {
    const { events, redis } = service();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    redis.eval.mockResolvedValueOnce(0);
    await expect(events.providerRead('football', 'fixtures', {})).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(events.providerRead('football', 'fixtures', {})).rejects.toThrow();
  });
});
