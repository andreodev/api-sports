import 'reflect-metadata';
import { FootballSyncRepository } from '../dist/football/sync/football-sync.repository.js';
import { FootballSyncWorker } from '../dist/football/sync/football-sync.worker.js';

const db = new URL(process.env.DATABASE_URL ?? '');
if (db.hostname !== 'postgres' || db.pathname !== '/sports_integration_test' || process.env.API_SPORTS_KEY !== 'local-provider-not-enabled') throw new Error('Ambiente isolado de teste obrigatório');
const id = '880000001'; process.env.FOOTBALL_SYNC_FIXTURE_IDS = id;
const repository = new FootballSyncRepository();
let phase = 0;
const feed = { async footballOdds() {
  phase++;
  if (phase === 4) throw new Error('Falha simulada');
  const now = Date.now();
  return { fixtureId: id, bookmakerId: 8, status: 'NS', startTime: new Date(now + 86400000).toISOString(), observedAt: new Date(now + phase * 10).toISOString(), providerUpdatedAt: new Date(now - 1000).toISOString(), reason: 'PREVIEW_ONLY', bettable: false, selections: [{ type: 'HOME_WIN', name: 'Casa', category: 'Resultado', value: phase === 1 ? 1.9 : 2.1 }, ...(phase < 3 ? [{ type: 'DRAW', name: 'Empate', category: 'Resultado', value: 3.1 }] : [])] };
} };
const worker = new FootballSyncWorker(feed, repository);
try {
  const runs = [];
  for (let index = 0; index < 4; index++) runs.push(await worker.run());
  const result = await repository.read(id);
  const home = result?.selections.find((item) => item.selection_type === 'HOME_WIN');
  const draw = result?.selections.find((item) => item.selection_type === 'DRAW');
  const ok = runs.slice(0, 3).every((run) => run.succeeded === 1) && runs[3].failed === 1 && Number(home?.price) === 2.1 && Number(home?.previous_price) === 1.9 && draw?.unavailable === true && result?.bettable === false;
  console.log(JSON.stringify({ fixtureId: id, runs, priceChanged: Number(home?.previous_price) === 1.9 && Number(home?.price) === 2.1, missingSelectionSuspended: draw?.unavailable === true, bettable: result?.bettable, ok }));
  if (!ok) process.exitCode = 1;
} finally { await worker.onApplicationShutdown(); await repository.onApplicationShutdown(); }
