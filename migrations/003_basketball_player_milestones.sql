BEGIN;
ALTER TABLE basketball_sync_player_selections
  DROP CONSTRAINT IF EXISTS basketball_sync_player_selections_selection_side_check;
ALTER TABLE basketball_sync_player_selections
  ADD CONSTRAINT basketball_sync_player_selections_selection_side_check
  CHECK (selection_side IN ('over', 'under', 'milestone'));
COMMIT;
