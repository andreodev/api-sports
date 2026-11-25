const services = [
  ['football', 'https://v3.football.api-sports.io/status'],
  ['basketball', 'https://v1.basketball.api-sports.io/status'],
];
if (!process.env.API_SPORTS_KEY) throw new Error('API_SPORTS_KEY não configurada');
for (const [sport, url] of services) {
  try {
    const response = await fetch(url, { headers: { 'x-apisports-key': process.env.API_SPORTS_KEY }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const body = await response.json();
    const requests = body?.response?.requests;
    const result = { sport, httpStatus: response.status, authenticated: response.ok && Object.keys(body?.errors ?? {}).length === 0, dailyLimit: requests?.limit_day ?? null, dailyUsed: requests?.current ?? null, minuteLimit: response.headers.get('x-ratelimit-limit') };
    console.log(JSON.stringify(result));
    if (!result.authenticated) process.exitCode = 1;
  } catch { console.error(JSON.stringify({ sport, error: 'Falha ao consultar status do provedor' })); process.exitCode = 1; }
}
