import 'reflect-metadata';
import dns from 'node:dns';

// Optional diagnostic override; it does not change the host's DNS settings.
if (process.env.API_SPORTS_TEST_DNS) {
  dns.setServers([process.env.API_SPORTS_TEST_DNS]);
  const originalLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    if (!hostname.endsWith('.api-sports.io')) return originalLookup(hostname, options, callback);
    const done = typeof options === 'function' ? options : callback;
    dns.resolve4(hostname, (error, addresses) => {
      if (error) return done(error);
      if (typeof options === 'object' && options.all) return done(null, addresses.map((address) => ({ address, family: 4 })));
      return done(null, addresses[0], 4);
    });
  };
}
const { EventsService } = await import('../dist/multisport/events.service.js');

const date = new Date().toISOString().slice(0, 10);
const service = new EventsService();
try {
  for (const sport of ['football', 'basketball', 'formula-1']) {
    try {
      const result = await service.events(sport, date);
      console.log(JSON.stringify({ sport, date, events: result.events.length, observedAt: result.observedAt }));
      if (sport === 'football') {
        const upcoming = result.events.find((event) => event.status?.short === 'NS' && Date.parse(event.startTime) > Date.now());
        if (upcoming) {
          const odds = await service.footballOdds(upcoming.externalId);
          console.log(JSON.stringify({ sport, fixtureId: odds.fixtureId, status: odds.status, selections: odds.selections.length, reason: odds.reason }));
        } else console.log(JSON.stringify({ sport, odds: 'no upcoming fixture today' }));
      }
    } catch (error) {
      console.error(JSON.stringify({ sport, status: error.getStatus?.() ?? 500, message: error.message }));
      process.exitCode = 1;
    }
  }
  try {
    const response = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    const ok = response.ok && body && typeof body === 'object' && Object.keys(body.errors ?? {}).length === 0;
    console.log(JSON.stringify({ sport: 'football', status: response.status, authenticated: !!ok }));
    if (!ok) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ sport: 'football', message: 'Falha de conexão' }));
    process.exitCode = 1;
  }
} finally {
  await service.onApplicationShutdown();
}
