import { mapApiOdd } from './odds-mapper.js';

export function mapPrematchOdds(bets: unknown) {
  if (!Array.isArray(bets)) return [];
  const mapped = new Map<string, { type: string; category: string; name: string; value: number }>();
  for (const bet of bets) {
    if (typeof bet?.name !== 'string' || !Array.isArray(bet.values)) continue;
    for (const choice of bet.values) {
      if (typeof choice?.value !== 'string') continue;
      const odd = mapApiOdd(bet.name, choice.value, choice.handicap);
      const price = typeof choice.odd === 'string' || typeof choice.odd === 'number' ? Number(choice.odd) : NaN;
      if (!odd || !Number.isFinite(price) || price <= 1 || price > 10_000 || mapped.has(odd.type)) continue;
      mapped.set(odd.type, { ...odd, value: price });
    }
  }
  return [...mapped.values()];
}
