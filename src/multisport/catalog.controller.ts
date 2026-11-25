import { Controller, Get, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../access/api-key.guard.js';
import { API_SPORTS_CATALOG } from './sports-catalog.js';

@Controller('v1/provider-catalog')
@UseGuards(ApiKeyGuard, ThrottlerGuard)
export class CatalogController {
  @Get()
  list() {
    return { sports: API_SPORTS_CATALOG.map(({ id, slug, name, leaguesSupported, oddsSupported, liveOddsSupported, aliasOf }) => ({ id, slug, name, leaguesSupported, oddsSupported, liveOddsSupported, ...(aliasOf ? { aliasOf } : {}) })) };
  }
}
