BEGIN;
DO $$ BEGIN
  IF current_database() <> 'casino_integration_test' OR current_user <> 'sports_test' THEN
    RAISE EXCEPTION 'Este seed só pode rodar no banco isolado de teste';
  END IF;
END $$;
INSERT INTO sports (id,name,image,slug,updated_at) VALUES ('a1000000-0000-4000-8000-000000000001','Futebol','', 'futebol',now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO sport_zones (id,name,code,flag,updated_at) VALUES ('a1000000-0000-4000-8000-000000000002','Brasil','BR-TEST','',now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO sport_leagues (id,name,type,logo,updated_at) VALUES ('a1000000-0000-4000-8000-000000000003','Liga de teste','League','',now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO sport_matches (id,sport_id,zone_id,league_id,home_team,away_team,start_time,external_id,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','Casa teste','Fora teste',now()+interval '1 day','880000001',now())
ON CONFLICT (id) DO UPDATE SET start_time=EXCLUDED.start_time,updated_at=now();
INSERT INTO sport_odds (id,match_id,type,name,category,value,updated_at) VALUES
('a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000004','HOME_WIN','Casa','Resultado',1.5,now()),
('a1000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000004','DRAW','Empate','Resultado',3.0,now()) ON CONFLICT (id) DO NOTHING;
COMMIT;
