$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $identity = (docker compose --env-file .env.integration -f compose.integration.yaml exec -T postgres psql -U sports_test -d sports_integration_test -Atc 'SELECT current_database(), current_user').Trim()
  if ($LASTEXITCODE -ne 0 -or $identity -ne 'sports_integration_test|sports_test') { throw 'Destino de teste não confirmado; migration não executada.' }
  Get-Content -Raw migrations/001_football_sync.sql | docker compose --env-file .env.integration -f compose.integration.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U sports_test -d sports_integration_test
  if ($LASTEXITCODE -ne 0) { throw 'Migration falhou.' }
} finally { Pop-Location }
