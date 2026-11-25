BEGIN;
CREATE TABLE IF NOT EXISTS football_sync_control (
  id integer PRIMARY KEY CHECK (id = 1),
  generation bigint NOT NULL DEFAULT 0
);
INSERT INTO football_sync_control (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS football_sync_fixtures (
  external_id text PRIMARY KEY,
  status text,
  start_time timestamptz,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS football_sync_markets (
  fixture_id text NOT NULL REFERENCES football_sync_fixtures(external_id),
  bookmaker_id integer NOT NULL,
  market_group text NOT NULL,
  suspended boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (fixture_id, bookmaker_id, market_group)
);
CREATE TABLE IF NOT EXISTS football_sync_selections (
  fixture_id text NOT NULL,
  bookmaker_id integer NOT NULL,
  market_group text NOT NULL,
  selection_type text NOT NULL,
  name text NOT NULL,
  price numeric NOT NULL CHECK (price > 1),
  previous_price numeric,
  price_changed_at timestamptz,
  suspended boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  provider_updated_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (fixture_id, bookmaker_id, selection_type),
  FOREIGN KEY (fixture_id, bookmaker_id, market_group) REFERENCES football_sync_markets(fixture_id, bookmaker_id, market_group)
);
CREATE TABLE IF NOT EXISTS football_sync_runs (
  id bigserial PRIMARY KEY,
  generation bigint NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  requested integer NOT NULL,
  succeeded integer NOT NULL,
  failed integer NOT NULL
);
CREATE OR REPLACE VIEW football_sync_current_selections AS
SELECT s.*, (s.suspended OR m.suspended OR s.expires_at <= now() OR m.expires_at <= now()) AS unavailable,
       false AS bettable
FROM football_sync_selections s
JOIN football_sync_markets m USING (fixture_id, bookmaker_id, market_group);
COMMIT;
