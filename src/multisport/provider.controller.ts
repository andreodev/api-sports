import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../access/api-key.guard.js';
import { EventsService } from './events.service.js';

@Controller('v1/provider')
@UseGuards(ApiKeyGuard, ThrottlerGuard)
export class ProviderController {
  constructor(private readonly events: EventsService) {}

  @Get(':sport/:endpoint')
  async read(@Param('sport') sport: string, @Param('endpoint') endpoint: string, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const result = await this.events.providerRead(sport, endpoint, query);
    response.setHeader('cache-control', 'no-store');
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
    return result.body;
  }

  @Get('football/odds/live')
  async liveOdds(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const result = await this.events.providerRead('football', 'odds/live', query);
    response.setHeader('cache-control', 'no-store');
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
    return result.body;
  }
}
