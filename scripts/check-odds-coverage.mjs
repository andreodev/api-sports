const fixtureId = process.argv[2];
if (!/^[1-9]\d*$/.test(fixtureId ?? '')) throw new Error('Informe o ID da partida');
for (const bookmaker of [null, '8']) {
  const url = new URL('https://v3.football.api-sports.io/odds');
  url.searchParams.set('fixture', fixtureId);
  if (bookmaker) url.searchParams.set('bookmaker', bookmaker);
  const response = await fetch(url, { headers: { 'x-apisports-key': process.env.API_SPORTS_KEY }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  console.log(JSON.stringify({ fixtureId, bookmaker: bookmaker ?? 'all', status: response.status, results: data.results, errorCount: Object.keys(data.errors ?? {}).length, bookmakerIds: (data.response ?? []).flatMap((row) => (row.bookmakers ?? []).map((item) => item.id)) }));
  if (!response.ok || Object.keys(data.errors ?? {}).length) process.exitCode = 1;
}
