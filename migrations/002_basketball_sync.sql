BEGIN;

CREATE TABLE IF NOT EXISTS basketball_sync_control (
  id integer PRIMARY KEY CHECK (id = 1),
  generation bigint NOT NULL DEFAULT 0
);
INSERT INTO basketball_sync_control (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS basketball_sync_games (
  external_id text PRIMARY KEY,
  league_id text NOT NULL,
  league_name text NOT NULL,
  home_id text NOT NULL,
  home_name text NOT NULL,
  away_id text NOT NULL,
  away_name text NOT NULL,
  phase text NOT NULL,
  status_short text NOT NULL,
  start_time timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  odds_observed_at timestamptz,
  stats_observed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS basketball_sync_games_start_idx ON basketball_sync_games (start_time);

CREATE TABLE IF NOT EXISTS basketball_sync_player_selections (
  game_id text NOT NULL REFERENCES basketball_sync_games(external_id),
  selection_key text NOT NULL,
  bookmaker_id integer NOT NULL,
  bookmaker_name text NOT NULL,
  provider_market_id integer NOT NULL,
  player_name text NOT NULL,
  team_side text CHECK (team_side IN ('home', 'away')),
  statistic text NOT NULL CHECK (statistic IN ('points', 'rebounds', 'assists')),
  selection_side text NOT NULL CHECK (selection_side IN ('over', 'under')),
  line numeric NOT NULL CHECK (line >= 0),
  price numeric NOT NULL CHECK (price > 1 AND price <= 10000),
  previous_price numeric,
  price_changed_at timestamptz,
  suspended boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  provider_updated_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, selection_key)
);

CREATE TABLE IF NOT EXISTS basketball_sync_runs (
  id bigserial PRIMARY KEY,
  generation bigint NOT NULL,
  started_at timestamptz NOT NULL,
  requested integer NOT NULL,
  succeeded integer NOT NULL,
  failed integer NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS basketball_sync_player_statistics (
  game_id text NOT NULL REFERENCES basketball_sync_games(external_id),
  player_id text NOT NULL,
  team_id text NOT NULL,
  player_name text NOT NULL,
  minutes_played text,
  points integer CHECK (points >= 0),
  rebounds integer CHECK (rebounds >= 0),
  assists integer CHECK (assists >= 0),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE OR REPLACE VIEW basketball_sync_current_selections AS
SELECT s.*, (s.suspended OR s.expires_at <= now() OR g.phase <> 'scheduled' OR g.start_time <= now()) AS unavailable,
       false AS bettable
FROM basketball_sync_player_selections s
JOIN basketball_sync_games g ON g.external_id = s.game_id;

COMMIT;
