BEGIN;
ALTER TABLE basketball_sync_player_selections
  DROP CONSTRAINT IF EXISTS basketball_sync_player_selections_statistic_check;
ALTER TABLE basketball_sync_player_selections
  ADD CONSTRAINT basketball_sync_player_selections_statistic_check
  CHECK (statistic IN ('points', 'rebounds', 'assists', 'points_assists'));
COMMIT;
