import { BadRequestException, Controller, Get, NotFoundException, Param, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../access/api-key.guard.js';
import { EventsService } from './events.service.js';
import { FootballSyncRepository } from '../football/sync/football-sync.repository.js';
import { BasketballSyncRepository } from '../basketball/basketball-sync.repository.js';

@Controller('v1/sports')
@UseGuards(ApiKeyGuard, ThrottlerGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService, private readonly syncRepository: FootballSyncRepository, private readonly basketballRepository: BasketballSyncRepository) {}
  @Get(':sport/events')
  events(@Param('sport') sport: string, @Query('date') date: string) { return this.eventsService.events(sport, date); }

  @Get('basketball/games/:id/player-markets')
  playerMarkets(@Param('id') id: string) { return this.eventsService.basketballPlayerMarkets(id); }

  @Get('basketball/games/:id/player-board')
  playerBoard(@Param('id') id: string) { return this.eventsService.basketballPlayerBoard(id); }

  @Get('basketball/games/:id/player-statistics')
  playerStatistics(@Param('id') id: string) { return this.eventsService.basketballPlayerStatistics(id); }

  @Get('basketball/games/:id/sync')
  async syncedBasketball(@Param('id') id: string) {
    if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new BadRequestException('Identificador inválido');
    let result: Awaited<ReturnType<BasketballSyncRepository['read']>>;
    try { result = await this.basketballRepository.read(id); } catch { throw new ServiceUnavailableException('Dados sincronizados indisponíveis'); }
    if (!result) throw new NotFoundException('Partida não sincronizada');
    return result;
  }

  @Get('football/fixtures/:id/odds')
  footballOdds(@Param('id') id: string) { return this.eventsService.footballOdds(id); }

  @Get('football/fixtures/:id/sync')
  async syncedFootballOdds(@Param('id') id: string) {
    if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new BadRequestException('Identificador inválido');
    let result: Awaited<ReturnType<FootballSyncRepository['read']>>;
    try { result = await this.syncRepository.read(id); } catch { throw new ServiceUnavailableException('Dados sincronizados indisponíveis'); }
    if (!result) throw new NotFoundException('Partida não sincronizada');
    return result;
  }
}
