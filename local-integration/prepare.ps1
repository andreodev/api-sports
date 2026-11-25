param(
  [string]$CasinoSource = 'C:\Users\andre\orca\casino-api',
  [string]$FrontendSource = 'C:\Users\andre\orca\casino-web'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$casino = Join-Path $root '.tmp/sports-local/casino-api'
$frontend = Join-Path $root '.tmp/sports-local/casino-web'
if ((Test-Path $casino) -or (Test-Path $frontend)) { throw 'As cópias de integração já existem; nada foi alterado.' }
git clone --no-hardlinks $CasinoSource $casino
if ($LASTEXITCODE -ne 0) { throw 'Falha ao clonar casino-api' }
git clone --no-hardlinks $FrontendSource $frontend
if ($LASTEXITCODE -ne 0) { throw 'Falha ao clonar frontend' }
python (Join-Path $PSScriptRoot 'copy-frontend-worktree.py') $FrontendSource $frontend
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar alterações locais do frontend' }
git -C $casino apply (Join-Path $PSScriptRoot 'casino-preview.patch')
if ($LASTEXITCODE -ne 0) { throw 'Patch incompatível com a versão do casino-api' }
Copy-Item (Join-Path $PSScriptRoot 'casino-files/central-preview.ts') (Join-Path $casino 'src/sportsbook/central-preview.ts')
Copy-Item (Join-Path $PSScriptRoot 'casino-files/central-preview.spec.ts') (Join-Path $casino 'src/sportsbook/central-preview.spec.ts')
Copy-Item (Join-Path $PSScriptRoot 'casino-files/local-readonly.ts') (Join-Path $casino 'src/local-readonly.ts')
Copy-Item (Join-Path $PSScriptRoot 'casino-files/Dockerfile.integration') (Join-Path $casino 'Dockerfile.integration')
Copy-Item (Join-Path $PSScriptRoot 'casino-files/dockerignore') (Join-Path $casino '.dockerignore')
Copy-Item (Join-Path $PSScriptRoot 'frontend-files/Dockerfile.integration') (Join-Path $frontend 'Dockerfile.integration')
Copy-Item (Join-Path $PSScriptRoot 'frontend-files/dockerignore') (Join-Path $frontend '.dockerignore')
python (Join-Path $PSScriptRoot 'configure-fonts.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao configurar fontes locais' }
Write-Host 'Cópias isoladas preparadas; alterações locais do frontend foram copiadas e verificadas.'
