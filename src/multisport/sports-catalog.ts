/** Provider capabilities are separate from the subscription's endpoint access.
 * None of these APIs documents an in-play betting odds endpoint. */
export type ApiSportId =
  | 'basketball'
  | 'baseball'
  | 'hockey'
  | 'handball'
  | 'rugby'
  | 'volleyball'
  | 'american-football'
  | 'mma'
  | 'afl'
  | 'formula-1'
  | 'nba';

export interface ApiSportDefinition {
  id: ApiSportId;
  slug: string;
  name: string;
  baseUrl: string;
  eventPath: '/games' | '/fights' | '/races';
  leaguesSupported: boolean;
  oddsSupported: boolean;
  liveOddsSupported: false;
  oddsRefreshMs: number | null;
  documentationUrl: string;
  aliasOf?: ApiSportId;
  note?: string;
}

const DAY = 24 * 60 * 60_000;

function sport(
  id: ApiSportId,
  slug: string,
  name: string,
  extra: Partial<ApiSportDefinition> = {},
): ApiSportDefinition {
  const docsId = id === 'american-football' ? 'nfl' : id;
  return Object.freeze({
    id,
    slug,
    name,
    baseUrl: `https://v1.${id}.api-sports.io`,
    eventPath: '/games',
    leaguesSupported: true,
    oddsSupported: true,
    liveOddsSupported: false,
    oddsRefreshMs: DAY,
    documentationUrl: `https://api-sports.io/documentation/${docsId}/v1`,
    ...extra,
  });
}

export const API_SPORTS_CATALOG: readonly ApiSportDefinition[] = Object.freeze([
  sport('basketball', 'basquete', 'Basquete'),
  sport('baseball', 'beisebol', 'Beisebol'),
  sport('hockey', 'hoquei', 'Hóquei no gelo'),
  sport('handball', 'handebol', 'Handebol'),
  sport('rugby', 'rugby', 'Rugby'),
  sport('volleyball', 'volei', 'Vôlei'),
  sport('american-football', 'futebol-americano', 'Futebol americano', {
    oddsRefreshMs: DAY / 4,
  }),
  sport('mma', 'mma', 'MMA', {
    eventPath: '/fights',
    leaguesSupported: false,
    oddsRefreshMs: DAY / 4,
  }),
  sport('afl', 'futebol-australiano', 'Futebol australiano', {
    // Official architecture publishes games -> odds -> bookmakers/bets.
    // Use the conservative daily cadence until a shorter refresh is verified.
    note: 'Odds pré-jogo; atualização consultada de forma conservadora a cada 24 horas.',
  }),
  sport('formula-1', 'formula-1', 'Fórmula 1', {
    eventPath: '/races',
    leaguesSupported: false,
    oddsSupported: false,
    oddsRefreshMs: null,
    note: 'Corridas com múltiplos participantes; calendário sem apostas.',
  }),
  sport('nba', 'nba', 'NBA', {
    baseUrl: 'https://v2.nba.api-sports.io',
    documentationUrl: 'https://api-sports.io/documentation/nba/v2',
    aliasOf: 'basketball',
    oddsSupported: false,
    oddsRefreshMs: null,
    note: 'NBA é sincronizada pelo Basquete para evitar partidas duplicadas.',
  }),
]);

export function apiSportOf(id: string): ApiSportDefinition | null {
  return API_SPORTS_CATALOG.find((entry) => entry.id === id) ?? null;
}

/** New provider identities never collide with numeric football IDs. */
export function namespacedId(sportId: ApiSportId, id: unknown): string | null {
  const value = providerIdOf(id);
  return apiSportOf(sportId) && value !== null
    ? `apisports:${sportId}:${value}`
    : null;
}

export function providerIdOf(id: unknown): string | null {
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const value = String(id);
  return /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
    ? String(Number(value))
    : null;
}
