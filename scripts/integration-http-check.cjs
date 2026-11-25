const assert = require('node:assert/strict');
async function main() {
  const matchId = 'a1000000-0000-4000-8000-000000000004';
  const oddId = 'a1000000-0000-4000-8000-000000000005';
  const res = await fetch(`http://127.0.0.1:3333/sportsbook/matches/${matchId}`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.match.id, matchId);
  assert.equal(body.match.bettable, false);
  const home = body.match.odds.find((item) => item.id === oddId);
  assert.ok(home); assert.equal(home.value, 2.1); assert.equal(home.isActive, false);
  assert.ok(body.page.markets.every((market) => market.lines.every((line) => line.outcomes.every((odd) => odd.suspended && !odd.isActive))));
  const unauthorized = await fetch('http://sports:3000/v1/sports/football/fixtures/880000001/sync');
  assert.equal(unauthorized.status, 401);
  const financial = await fetch('http://127.0.0.1:3333/bets/tickets', { method: 'POST' });
  assert.equal(financial.status, 404);
  console.log(JSON.stringify({ matchId, centralPrice: home.value, localOddIdPreserved: home.id === oddId, bettable: body.match.bettable, allOutcomesSuspended: true, unauthorized: unauthorized.status, ticketRoute: financial.status }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
