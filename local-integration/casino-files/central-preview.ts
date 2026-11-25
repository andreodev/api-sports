import { Injectable } from '@nestjs/common';
import { SbMatchDetail } from './sportsbook.mapper';

/** Read-only preview; original casino UUIDs stay authoritative. */
@Injectable()
export class CentralPreview {
  async apply(
    local: SbMatchDetail,
    externalId: string | null,
  ): Promise<SbMatchDetail> {
    if (process.env.SPORTS_PREVIEW_ENABLED !== 'true') return local;
    const prices = new Map<string, number>();
    if (
      externalId &&
      /^\d+$/.test(externalId) &&
      local.match.status === 'UPCOMING'
    ) {
      try {
        const base = process.env.SPORTS_PREVIEW_URL;
        const key = process.env.SPORTS_PREVIEW_KEY;
        if (!base || !key) throw new Error('Preview unavailable');
        const response = await fetch(
          `${base.replace(/\/+$/, '')}/v1/sports/football/fixtures/${externalId}/sync`,
          {
            headers: { 'x-api-key': key },
            signal: AbortSignal.timeout(2000),
            redirect: 'error',
          },
        );
        if (!response.ok) throw new Error('Preview unavailable');
        const payload: any = await response.json();
        const remoteStart = Date.parse(payload?.startTime);
        const localStart = Date.parse(local.match.startTime);
        if (
          payload?.fixtureId !== externalId ||
          payload?.status !== 'NS' ||
          payload?.bettable !== false ||
          !Array.isArray(payload.selections) ||
          !Number.isFinite(remoteStart) ||
          !Number.isFinite(localStart) ||
          Math.abs(remoteStart - localStart) > 60_000
        )
          throw new Error('Invalid preview');
        const seen = new Set<string>();
        for (const row of payload.selections) {
          if (
            typeof row.selection_type !== 'string' ||
            seen.has(row.selection_type)
          )
            throw new Error('Duplicate selection');
          seen.add(row.selection_type);
          const value = Number(row.price);
          if (
            row.bettable === false &&
            row.unavailable === false &&
            Date.parse(row.expires_at) > Date.now() &&
            Number.isFinite(value) &&
            value > 1 &&
            value <= 10000
          )
            prices.set(row.selection_type, value);
        }
      } catch {
        prices.clear();
      }
    }
    const odd = (item: any) => ({
      ...item,
      value: prices.get(item.type) ?? item.value,
      isActive: false,
      builder: false,
    });
    return {
      ...local,
      match: {
        ...local.match,
        bettable: false,
        lockReason: 'SUSPENDED',
        odds: local.match.odds.map(odd),
        builderAvailability: { available: false, reason: 'DISABLED' },
      },
      page: {
        ...local.page,
        suspended: true,
        builderEnabled: false,
        builderAvailability: { available: false, reason: 'DISABLED' },
        markets: local.page.markets.map((market) => ({
          ...market,
          suspended: true,
          lines: market.lines.map((line) => ({
            ...line,
            outcomes: line.outcomes.map((outcome) => ({
              ...odd(outcome),
              suspended: true,
            })),
          })),
        })),
      },
    };
  }
}
