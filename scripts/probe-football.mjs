// Read-only diagnostic: at most two calls; does not print credentials.
const url = new URL('https://v3.football.api-sports.io/odds');
url.search = new URLSearchParams({ league: '39', season: '2026', bookmaker: '8' }).toString();
const response = await fetch(url, { headers: { 'x-apisports-key': process.env.API_SPORTS_KEY }, signal: AbortSignal.timeout(15000), redirect: 'error' });
const body = await response.json();
if (!response.ok || !Array.isArray(body.response) || Object.keys(body.errors ?? {}).length) {
  console.log(JSON.stringify({ status: response.status, errors: body.errors })); process.exitCode = 1;
} else {
  const future = body.response.filter((row) => Date.parse(row.fixture?.date) > Date.now());
  console.log(JSON.stringify({ status: response.status, results: body.results, paging: body.paging, future: future.slice(0, 5).map((row) => ({ fixture: row.fixture.id, date: row.fixture.date, bookmakerIds: row.bookmakers?.map((bookmaker) => bookmaker.id), markets: row.bookmakers?.flatMap((bookmaker) => bookmaker.bets?.map((bet) => bet.name) ?? []) })) }));
}
