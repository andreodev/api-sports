import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { runMigrations } from './database/migrate.js';

async function bootstrap() {
  if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS !== 'false') {
    const applied = await runMigrations(process.env.DATABASE_URL);
    console.log(applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Banco já atualizado');
  }
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
