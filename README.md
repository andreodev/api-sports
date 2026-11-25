# API de esportes

Serviço NestJS que consulta a API-Sports e oferece dados esportivos aos sistemas consumidores. O projeto está em fase de integração: as odds de futebol são apenas uma prévia e retornam `bettable: false`. A aceitação e a liquidação de apostas continuam sob responsabilidade do cassino.

O estado da migração, as limitações e as instruções do laboratório de integração estão em [docs/migracao-esportes.md](docs/migracao-esportes.md).

## Desenvolvimento local

Requisitos: Node.js, pnpm e Docker Compose. Instale as dependências com `pnpm install`, copie `.env.example` para `.env` e configure as credenciais. Gere uma chave por consumidor com `pnpm key:generate` e inclua-a em `API_CLIENTS`.

Inicie os serviços locais com `docker compose up -d --wait postgres redis`. A migration em `migrations/001_football_sync.sql` deve ser aplicada explicitamente ao banco da API esportiva, depois de conferir o destino; a aplicação não a executa automaticamente. Inicie a API com `pnpm start:dev`. O worker de futebol vem desativado e exige configuração adicional descrita na documentação da migração.

## Validação

Execute `pnpm build`, `pnpm lint`, `pnpm test` e `pnpm test:e2e`. Sem bancos de teste configurados, os testes que dependem de PostgreSQL ou Redis são ignorados. Para executá-los no PowerShell, configure um PostgreSQL dedicado cujo nome termine em `_test`, com a migration aplicada, e um Redis dedicado:

```powershell
$env:DATABASE_TEST_URL = 'postgresql://api_sports:local-dev-only@localhost:55432/api_sports_test'
$env:REDIS_TEST_URL = 'redis://127.0.0.1:56379'
pnpm test
pnpm test:e2e
```

Os testes usam os bancos Redis 9 a 15 e removem suas próprias chaves. Não use um Redis de produção. Os testes da cópia experimental do cassino são executados no ambiente próprio do cassino, conforme a documentação da integração.
