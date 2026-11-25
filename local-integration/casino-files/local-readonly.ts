import {
  Injectable,
  Module,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Controller,
  Get,
} from '@nestjs/common';
import { APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { map } from 'rxjs/operators';
import { PrismaModule } from './prisma/prisma.module';
import { SportsbookController } from './sportsbook/sportsbook.controller';
import { SportsbookService } from './sportsbook/sportsbook.service';
import { SportsbookCache } from './sportsbook/sportsbook.cache';
import { TicketSettingsService } from './bet/ticket/ticket-settings.service';
import { CentralPreview } from './sportsbook/central-preview';

function lockAll(value: any): any {
  if (Array.isArray(value)) return value.map(lockAll);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, lockAll(item)]),
  );
  if ('bettable' in result) result.bettable = false;
  if ('isActive' in result) result.isActive = false;
  if ('builder' in result) result.builder = false;
  if ('builderEnabled' in result) result.builderEnabled = false;
  if ('suspended' in result) result.suspended = true;
  if ('lockReason' in result) result.lockReason = 'SUSPENDED';
  if (
    'state' in result &&
    ['OPEN', 'SUSPENDED', 'CLOSED'].includes(String(result.state))
  )
    result.state = 'SUSPENDED';
  if ('builderAvailability' in result)
    result.builderAvailability = { available: false, reason: 'DISABLED' };
  return result;
}
@Injectable()
class ReadOnlyInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map(lockAll));
  }
}

// Synthetic values for existing public settings endpoints; no external services.
@Controller('settings')
class LocalSettingsController {
  @Get('access')
  access() {
    return { siteRestricted: false, name: 'Prévia local', logo: null };
  }

  @Get()
  settings() {
    return {
      id: 'local-test',
      name: 'Prévia local',
      title: 'Prévia local',
      logo: '',
      favicon: '',
      siteRestricted: false,
      maintenance: false,
      primaryColor: '#00d18e',
      secondaryColor: '#111827',
      tertiaryColor: '#202b3c',
      textPrimaryColor: '#ffffff',
      textSecondaryColor: '#cbd5e1',
      facebookPixelIsActive: false,
      googleAdsIsActive: false,
    };
  }
}

// Local test server: only the existing read-only sportsbook controller is registered.
@Module({
  imports: [PrismaModule],
  controllers: [SportsbookController, LocalSettingsController],
  providers: [
    SportsbookService,
    SportsbookCache,
    TicketSettingsService,
    CentralPreview,
    { provide: APP_INTERCEPTOR, useClass: ReadOnlyInterceptor },
  ],
})
class LocalReadOnlyModule {}

async function main() {
  const app = await NestFactory.create(LocalReadOnlyModule);
  app.enableCors({ origin: 'http://127.0.0.1:53003' });
  await app.listen(3333, '0.0.0.0');
}
void main();
