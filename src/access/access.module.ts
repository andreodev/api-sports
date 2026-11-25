import { Global, Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyGuard } from './api-key.guard.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

const storage = new RedisThrottlerStorage();
@Global()
@Module({
  imports: [ThrottlerModule.forRootAsync({
    useFactory: () => ({
      storage,
      throttlers: [{ ttl: 60_000, limit: 120 }],
      getTracker: (request) => String(request.consumerId),
      generateKey: (_context, tracker, name) => `${name}:${tracker}`,
    }),
  })],
  providers: [ApiKeyGuard, ThrottlerGuard, { provide: RedisThrottlerStorage, useValue: storage }],
  exports: [ApiKeyGuard, ThrottlerGuard],
})
export class AccessModule {}
