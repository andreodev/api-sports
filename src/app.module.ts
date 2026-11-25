import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AccessModule } from './access/access.module.js';
import { CatalogController } from './multisport/catalog.controller.js';
import { EventsController } from './multisport/events.controller.js';
import { EventsService } from './multisport/events.service.js';
import { ProviderController } from './multisport/provider.controller.js';
import { ScheduleModule } from '@nestjs/schedule';
import { FootballSyncWorker } from './football/sync/football-sync.worker.js';
import { FootballSyncRepository } from './football/sync/football-sync.repository.js';
import { BasketballSyncRepository } from './basketball/basketball-sync.repository.js';
import { BasketballSyncWorker } from './basketball/basketball-sync.worker.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    AccessModule,
    ScheduleModule.forRoot(),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'api-sports',
    }),
  ],
  controllers: [AppController, CatalogController, EventsController, ProviderController],
  providers: [AppService, EventsService, FootballSyncRepository, FootballSyncWorker, BasketballSyncRepository, BasketballSyncWorker],
})
export class AppModule {}
