export interface FootballSnapshot {
  fixtureId: string;
  bookmakerId: number;
  status: string | null;
  startTime: string | null;
  observedAt: string;
  providerUpdatedAt: string | null;
  reason: string;
  bettable: false;
  selections: Array<{ type: string; name: string; category: string; value: number }>;
}

export function marketGroup(type: string): string | null {
  if (['HOME_WIN', 'DRAW', 'AWAY_WIN'].includes(type)) return 'RESULT';
  if (/^(OVER|UNDER)_[123]_5$/.test(type)) return 'GOALS';
  if (['DC_1X', 'DC_12', 'DC_X2'].includes(type)) return 'DOUBLE_CHANCE';
  if (['BTTS_YES', 'BTTS_NO'].includes(type)) return 'BOTH_TEAMS';
  return null;
}
