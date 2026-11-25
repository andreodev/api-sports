import 'reflect-metadata';
import { EventsService } from '../dist/multisport/events.service.js';
import { FootballSyncRepository } from '../dist/football/sync/football-sync.repository.js';
import { FootballSyncWorker } from '../dist/football/sync/football-sync.worker.js';

const database = new URL(process.env.DATABASE_URL ?? '');
if (!database.pathname.endsWith('_test')) throw new Error('Use apenas um banco de teste dedicado');
const id = process.env.FOOTBALL_SYNC_FIXTURE_IDS;
if (!/^[1-9]\d*$/.test(id ?? '')) throw new Error('Configure exatamente um ID');
const events = new EventsService(), repository = new FootballSyncRepository();
const worker = new FootballSyncWorker(events, repository);
try {
  const run = await worker.run();
  const result = await repository.read(id);
  console.log(JSON.stringify({ run, fixtureId: result?.fixtureId, status: result?.status, bettable: result?.bettable, selections: result?.selections.length, unavailable: result?.selections.filter((selection) => selection.unavailable).length }));
  if (run.status !== 'done' || run.failed || !result || result.bettable !== false) process.exitCode = 1;
} finally {
  await worker.onApplicationShutdown(); await events.onApplicationShutdown(); await repository.onApplicationShutdown();
}
