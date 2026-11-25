/**
 * Mapeamento dos mercados da API-Football (api-sports.io v3) para os tipos
 * internos de odds usados no sportbook.
 *
 * Tipos internos suportados (mercados "ampliados"):
 *  - Resultado (1X2):      HOME_WIN | DRAW | AWAY_WIN
 *  - Gols (Over/Under):    OVER_1_5 | UNDER_1_5 | OVER_2_5 | UNDER_2_5 | OVER_3_5 | UNDER_3_5
 *  - Dupla Chance:         DC_1X | DC_12 | DC_X2
 *  - Ambas Marcam (BTTS):  BTTS_YES | BTTS_NO
 */

export const ODD_CATEGORIES = {
  RESULT: 'Resultado',
  GOALS: 'Gols',
  DOUBLE_CHANCE: 'Dupla Chance',
  BTTS: 'Ambas Marcam',
} as const;

export interface MappedOdd {
  type: string;
  category: string;
  name: string;
}

const OVER_UNDER_LINES = ['1.5', '2.5', '3.5'];

function normalize(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function isOver(val: string): boolean {
  return val === 'over' || val.startsWith('over ');
}

function isUnder(val: string): boolean {
  return val === 'under' || val.startsWith('under ');
}

/**
 * Resolve a linha de gols. No pré-jogo vem embutida no valor ("Over 2.5");
 * ao vivo vem no campo `handicap` ("Over" + handicap "2.5").
 */
function resolveLine(val: string, handicap?: string | number | null): string | null {
  let n: number | null = null;
  if (handicap !== undefined && handicap !== null && String(handicap).trim() !== '') {
    const m = String(handicap).match(/-?\d+(\.\d+)?/);
    if (m) n = parseFloat(m[0]);
  }
  if (n === null) {
    const m = val.match(/\d+(\.\d+)?/);
    if (m) n = parseFloat(m[0]);
  }
  if (n === null || !Number.isFinite(n)) return null;
  return String(n);
}

/**
 * Converte (nome do mercado, valor[, handicap]) da API-Football em um tipo
 * interno. Tolera tanto o pré-jogo (`/odds`) quanto o ao vivo (`/odds/live`),
 * cujos nomes diferem. Retorna `null` quando o mercado/valor não é suportado.
 */
export function mapApiOdd(
  betName: string,
  value: string,
  handicap?: string | number | null,
): MappedOdd | null {
  const market = normalize(betName);
  const val = normalize(value);

  // 1X2 — pré-jogo "Match Winner" | ao vivo "Fulltime Result"
  if (
    market === 'match winner' ||
    market === 'fulltime result' ||
    market === 'full time result'
  ) {
    if (val === 'home') {
      return { type: 'HOME_WIN', category: ODD_CATEGORIES.RESULT, name: 'Casa' };
    }
    if (val === 'draw') {
      return { type: 'DRAW', category: ODD_CATEGORIES.RESULT, name: 'Empate' };
    }
    if (val === 'away') {
      return { type: 'AWAY_WIN', category: ODD_CATEGORIES.RESULT, name: 'Fora' };
    }
    return null;
  }

  // Over/Under gols — pré "Goals Over/Under" | live "Over/Under Line" | "Match Goals"
  // (nomes específicos para NÃO capturar escanteios/cartões)
  if (
    market === 'goals over/under' ||
    market === 'over/under line' ||
    market === 'match goals'
  ) {
    const line = resolveLine(val, handicap);
    if (line && OVER_UNDER_LINES.includes(line)) {
      const suffix = line.replace('.', '_');
      if (isOver(val)) {
        return {
          type: `OVER_${suffix}`,
          category: ODD_CATEGORIES.GOALS,
          name: `Mais de ${line}`,
        };
      }
      if (isUnder(val)) {
        return {
          type: `UNDER_${suffix}`,
          category: ODD_CATEGORIES.GOALS,
          name: `Menos de ${line}`,
        };
      }
    }
    return null;
  }

  // Dupla Chance — pré "Home/Draw" | live "Home or Draw"
  if (market === 'double chance') {
    if (val === 'home/draw' || val === 'home or draw') {
      return {
        type: 'DC_1X',
        category: ODD_CATEGORIES.DOUBLE_CHANCE,
        name: 'Casa ou Empate',
      };
    }
    if (val === 'home/away' || val === 'home or away') {
      return {
        type: 'DC_12',
        category: ODD_CATEGORIES.DOUBLE_CHANCE,
        name: 'Casa ou Fora',
      };
    }
    if (val === 'draw/away' || val === 'away or draw' || val === 'draw or away') {
      return {
        type: 'DC_X2',
        category: ODD_CATEGORIES.DOUBLE_CHANCE,
        name: 'Empate ou Fora',
      };
    }
    return null;
  }

  // Ambas Marcam — "Both Teams Score" / "Both Teams To Score" (exato; evita "(2nd Half)")
  if (market === 'both teams score' || market === 'both teams to score') {
    if (val === 'yes') {
      return { type: 'BTTS_YES', category: ODD_CATEGORIES.BTTS, name: 'Sim' };
    }
    if (val === 'no') {
      return { type: 'BTTS_NO', category: ODD_CATEGORIES.BTTS, name: 'Não' };
    }
    return null;
  }

  return null;
}

/**
 * Dado o placar final, retorna o conjunto de tipos internos vencedores.
 * Usado na liquidação (settlement) das apostas.
 */
export function computeWinningTypes(
  homeScore: number,
  awayScore: number,
): Set<string> {
  const winners = new Set<string>();
  const total = homeScore + awayScore;

  // Resultado
  if (homeScore > awayScore) winners.add('HOME_WIN');
  else if (homeScore === awayScore) winners.add('DRAW');
  else winners.add('AWAY_WIN');

  // Over/Under
  for (const line of OVER_UNDER_LINES) {
    const suffix = line.replace('.', '_');
    if (total > parseFloat(line)) winners.add(`OVER_${suffix}`);
    else winners.add(`UNDER_${suffix}`);
  }

  // Dupla Chance
  if (homeScore >= awayScore) winners.add('DC_1X'); // casa ou empate
  if (homeScore !== awayScore) winners.add('DC_12'); // casa ou fora
  if (awayScore >= homeScore) winners.add('DC_X2'); // empate ou fora

  // Ambas Marcam
  if (homeScore > 0 && awayScore > 0) winners.add('BTTS_YES');
  else winners.add('BTTS_NO');

  return winners;
}
