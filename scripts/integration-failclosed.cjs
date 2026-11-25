const assert = require('node:assert/strict');
async function main() {
  const res = await fetch('http://127.0.0.1:3333/sportsbook/matches/a1000000-0000-4000-8000-000000000004');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.match.bettable, false);
  assert.ok(body.match.odds.every((odd) => odd.isActive === false));
  assert.equal(body.match.odds.find((odd) => odd.id === 'a1000000-0000-4000-8000-000000000005')?.value, 1.5);
  assert.ok(body.page.markets.every((market) => market.lines.every((line) => line.outcomes.every((odd) => odd.suspended && !odd.isActive))));
  console.log(JSON.stringify({ status: res.status, bettable: body.match.bettable, allInactive: true }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
