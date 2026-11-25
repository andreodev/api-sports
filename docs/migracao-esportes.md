# Migração do serviço de esportes

## Basquete: armazenamento de teste

`migrations/002_basketball_sync.sql` cria tabelas próprias para jogos, seleções de jogadores, estatísticas e execuções, sem modificar as tabelas de futebol. A migration deve ser executada explicitamente no banco **da API esportiva** após conferir o destino. O serviço não a aplica automaticamente.

O worker `BASKETBALL_SYNC_ENABLED=true` consulta as agendas UTC de ontem, hoje e amanhã, registra os jogos e, em rotação, consulta até `BASKETBALL_SYNC_BATCH_SIZE` partidas futuras para mercados de pontos, rebotes e assistências. O padrão é NBA (`BASKETBALL_SYNC_LEAGUE_IDS=12`); uma lista vazia inclui outras ligas. Os valores válidos para o lote são de 1 a 3 e o cron padrão é uma vez por minuto. A sincronização vem desativada. Para jogos concluídos, o worker tenta buscar as estatísticas individuais de uma partida por rodada. Essas chamadas dividem a cota e o Redis com o futebol; os limites atuais são conservadores e não garantem que todas as partidas sejam atualizadas antes de a observação expirar. `API_SPORTS_MAX_REQUESTS_PER_MINUTE` e `API_SPORTS_BACKGROUND_MAX_REQUESTS_PER_MINUTE` configuram o orçamento agregado por janela móvel (padrões 10 e 6); o segundo deve ser menor, reservando capacidade para consultas interativas. Confira o plano e o uso por outros sistemas antes de ajustar e mantenha os mesmos valores e Redis em todas as réplicas.

`GET /v1/sports/basketball/games/:id/sync`, autenticado por `x-api-key`, retorna jogo, seleções e estatísticas persistidas. O `id` é o ID numérico da partida no provedor. Seleções ausentes em uma consulta completa são suspensas; dados expirados, de jogo iniciado ou de status diferente de agendado ficam indisponíveis. A leitura inclui `bettable: false` e `settlementReady: false`: nomes das odds ainda não são uma identidade validada para apuração, e uma pessoa ausente nas estatísticas não comprova que não jogou. Estatísticas exigem jogo e times correspondentes e são apresentadas somente para a última observação completa armazenada.

Regras escolhidas para a futura integração operacional: contar prorrogação; anular a seleção se o atleta não entrar em quadra; odd promocional da Super Combo definida pelo administrador. Essas regras ainda precisam ser implementadas e testadas no aceite, apuração, anulação, correção e precificação combinada do cassino. O armazenamento ou a resposta da API não são autorização para apostar, liquidar ou publicar em produção.

## Inventário da origem

O `casino-api` reúne catálogo e resultados esportivos, integração com provedores e operações de apostas no mesmo processo e no mesmo schema Prisma. Os principais módulos são:

- `sport`, `zone`, `league`, `match` e `sportsbook`: catálogo, partidas, mercados e consultas públicas.
- `football` e `multisport`: integração com API-Sports, sincronização de catálogo, partidas e odds.
- `bet` e `sportsbook/ticket-admin`: bilhetes, liquidação, cash-out e operações administrativas.
- `match-insights`, `superodd`, `odds-boosts` e `sports-bonuses`: funcionalidades adicionais com vínculos a apostas e usuários.

As rotas atuais incluem `/sports`, `/zones`, `/leagues`, `/matches`, `/sportsbook`, `/football/integration`, `/multisport` e `/bets`. Algumas rotas administrativas e de apostas usam os guards e a identidade do cassino. Nem todas as rotas de um mesmo prefixo têm a mesma responsabilidade.

O schema contém tanto entidades esportivas quanto `User`, `UserWallet` e `Transaction`. A liquidação e o cash-out acessam dados financeiros e não podem ser separados com segurança apenas copiando os módulos. A identidade dos registros, as transações e a idempotência precisam ser preservadas na integração escolhida.

## Pontos para o desenho do serviço

- Definir se o serviço central possui apenas dados esportivos, também os bilhetes ou também as carteiras; estabelecer quem é responsável por cada operação financeira.
- Definir autenticação e identificação de cada consumidor, isolando limites e eventuais dados específicos de cada sistema.
- Preservar os contratos HTTP necessários aos consumidores e planejar a transição dos identificadores e dados existentes.
- Usar Redis com expiração para cache e armazenamento compartilhado dos limites entre instâncias. Definir o comportamento em caso de indisponibilidade.
- Coordenar a cota de chamadas ao provedor entre instâncias; os limitadores atuais de futebol e multisport mantêm estado em memória por processo.
- Garantir execução única ou coordenação distribuída dos jobs de sincronização e liquidação durante a transição. A origem agenda jobs de futebol, multisport, cash-out e liquidação.
- Migrar testes e adaptar imports CommonJS, aliases e mocks Jest ao ESM e Vitest deste projeto.

## Decisões tomadas

O serviço central será responsável pelos dados esportivos. Cada sistema consumidor continuará responsável por suas apostas e seus saldos. A autenticação entre serviços usará uma chave de API por sistema.

O serviço consultará a API-Sports, normalizará os dados e os distribuirá aos consumidores. O Redis será usado como cache temporário e para coordenação e limites; não há necessidade de copiar os dados financeiros ou o histórico completo do cassino. Os identificadores e as regras usadas pelos consumidores ainda precisam ser avaliados para compatibilidade durante a transição. PostgreSQL no Compose é opcional para desenvolvimento e não é uma dependência implementada da API atual.

### Compatibilidade encontrada no casino-api

- Futebol identifica partidas e ligas importadas pelo ID numérico do provedor em `externalId`. Multisport usa `apisports:<modalidade>:<id>`; NBA é alias do basquete.
- Cada banco de cassino gera seus próprios UUIDs para partidas e odds. Bilhetes referenciam esses UUIDs locais. A integração deve atualizar registros locais existentes usando `externalId` e a identidade do mercado, preservando seus UUIDs; não deve substituir esses IDs por IDs centrais.
- Multisport importa o mercado pré-jogo de duas seleções `MS_WIN_HOME` e `MS_WIN_AWAY`; F1 é informativa. Mantêm-se as regras de indisponibilidade, observação e expiração da origem.
- A confirmação de resultados, o tratamento de divergências e a liquidação estão acoplados aos bilhetes locais. O serviço central pode fornecer observações e timestamps, mas cada cassino deve manter suas verificações e sua liquidação até haver integração testada que preserve essas garantias.
- Cota e pausas do provedor devem ser compartilhadas por modalidade e também pelo orçamento agregado, incluindo todas as réplicas. Uma resposta cacheada não pode ganhar um novo horário de observação e parecer mais recente do que é.

O catálogo estático de modalidades da integração multisport foi transferido para `src/multisport/sports-catalog.ts` e exposto em `GET /v1/provider-catalog`. A rota exige `x-api-key` e aplica um limite fixo de 120 requisições por minuto por consumidor no Redis; na ausência do Redis, responde 503. Configure `API_CLIENTS` e `REDIS_URL` conforme `.env.example`. Esta rota descreve capacidades do provedor e não substitui o catálogo de modalidades habilitadas da origem.

Para desenvolvimento local, `docker compose up -d --wait` inicia PostgreSQL e Redis acessíveis somente no loopback. Gere uma chave com `pnpm key:generate` e inclua-a no JSON `API_CLIENTS` em `.env`. Essas chaves ainda são configuradas por variável de ambiente, e mudanças exigem atualização da configuração do processo; não existe ainda gerenciamento persistente de clientes pela API. Para executar o teste de rate limit contra o Redis local no PowerShell: `$env:REDIS_TEST_URL='redis://127.0.0.1:56379'; pnpm test`.

A rota autenticada `GET /v1/sports/:sport/events?date=AAAA-MM-DD` consulta a agenda multisport e aplica a normalização da origem. Requer `API_SPORTS_KEY` e Redis; respostas são compartilhadas por 30 segundos, preservando `observedAt`. Uma trava limita consultas simultâneas para a mesma data e um limite conservador de 10 chamadas por minuto é compartilhado entre instâncias. Este endpoint é sob demanda e não inclui odds. A integração foi testada com Redis real e com respostas reais de basquete e Fórmula 1, e o status de futebol autenticou com sucesso. O DNS padrão desta máquina não resolveu os domínios do provedor; o teste usou DNS público apenas no processo de diagnóstico. A aplicação normal ainda depende de DNS funcional no ambiente onde for executada.

A rota de eventos também aceita `football` e preserva o `externalId` numérico da origem. A consulta real de futebol foi validada. Ainda faltam odds completas, consultas compatíveis com a origem, descoberta automática de partidas, tratamento completo das cotas e pausas do provedor e integração dos sistemas consumidores. As rotinas financeiras permanecem em cada sistema consumidor.

`GET /v1/sports/football/fixtures/:id/odds` consulta a partida e odds pré-jogo para a casa configurada por `FOOTBALL_BOOKMAKER_ID` (padrão 8), preserva o ID externo e aplica o mapeador legado de resultado, totais, dupla chance e ambas marcam. Resultado é uma prévia (`bettable: false`), sem escrita no cassino. Jogos iniciados, suspensos ou encerrados retornam sem seleções. O resultado fica no Redis por 15 segundos; respostas 429 ativam uma pausa compartilhada e a rota tenta novamente uma vez em falha de rede ou erro 5xx. Isso não implementa atualização contínua nem o catálogo completo e não substitui a confirmação de odds no aceite do cassino.

### Validação local de 19/11/2026

- A consulta anterior da partida `1546156` retornou zero resultados tanto sem filtro de casa quanto com `bookmaker=8`, sem erro HTTP ou erro no envelope. Isso demonstra ausência de odds naquela consulta, não uma falha de mapeamento; não comprova que a partida nunca teve cobertura.
- Uma consulta de odds da liga 39, temporada 2026, identificou partidas futuras com a casa 8. A rota HTTP da API foi executada para a partida `1557467` (21/11/2026) e retornou HTTP 200, o mesmo ID externo, casa 8, status `NS`, 14 seleções e `bettable: false`. Os quatro grupos — resultado, totais de gols, dupla chance e ambas marcam — estavam presentes. Uma amostra reduzida dessa resposta está em `src/football/__fixtures__/odds-prematch-real-1557467.json`; não deve ser usada como preço atual.
- O DNS padrão do Windows não resolveu os domínios, enquanto `1.1.1.1` e `8.8.8.8` responderam. A sessão não tinha privilégios administrativos para alterar o Windows. O serviço `api` no Compose usa esses servidores de DNS no contêiner; resolução e consulta HTTP foram confirmadas novamente após reiniciá-lo. O DNS do host permanece inalterado e precisará ser corrigido por um administrador para execução diretamente no Windows. O contêiner continua limitado a localhost no Compose de desenvolvimento.
- `pnpm run build`, `pnpm run lint`, a suíte de testes com Redis isolado (`REDIS_TEST_URL=redis://127.0.0.1:56379/15`) e `pnpm run test:e2e` passaram. Os testes cobrem resposta real gravada, odds inválidas, ausência de mercados, 429, pausa, falhas do provedor e cache.

Os testes usam bancos Redis dedicados; não aponte `REDIS_TEST_URL` para Redis de produção. A validação não altera bilhetes, saldos nem o banco do cassino. Não há integração automática com o cassino; o resultado segue impróprio para aceitar apostas.

## Mercados individuais de basquete

`GET /v1/sports/basketball/games/:id/player-markets` expõe, quando disponíveis no provedor, seleções individuais de pontos, rebotes e assistências (mais/menos), com jogador, linha, odd e casa de origem. A resposta informa `observedAt`, o horário da consulta, e `providerUpdatedAt` em cada seleção quando o provedor envia uma data válida. O resultado é uma prévia (`bettable: false`): não confirma a identidade ou time do jogador nem as regras da casa. `overtimeIncluded: null` significa que a inclusão de prorrogação ainda não foi verificada.

O agrupamento de seleções no mesmo jogo, como na opção “Criar Aposta”, exige preço próprio para a combinação e regras confirmadas de cada mercado. Esta rota não oferece essa cotação (`combinationPricing: UNAVAILABLE`); multiplicar odds individuais não produz uma cotação confiável para seleções correlacionadas. A disponibilidade varia por jogo e casa. A documentação do provedor descreve odds de basquete pré-jogo atualizadas uma vez ao dia: https://api-sports.io/documentation/basketball/basketball-v1.yaml. Estatísticas para apuração, identidade dos jogadores e confirmação de regras e cotação da combinação ainda precisam ser implementadas e validadas antes de uso operacional.

## Worker inicial de futebol

A migration `migrations/001_football_sync.sql` cria tabelas próprias para partidas, mercados, seleções e execuções e a view `football_sync_current_selections`. Aplique-a explicitamente ao banco **da API esportiva**, nunca ao banco do cassino. No Docker local ela foi aplicada aos bancos `api_sports` e `api_sports_test`. Em outro ambiente, execute `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_football_sync.sql` após revisar o destino; a aplicação não executa a migration automaticamente.

O worker vem desativado. Para habilitá-lo, defina `FOOTBALL_SYNC_ENABLED=true`, `FOOTBALL_SYNC_FIXTURE_IDS` com um a três IDs externos numéricos separados por vírgula e, opcionalmente, `FOOTBALL_SYNC_CRON` (padrão `* * * * *`). Cada rodada usa processamento serial, o orçamento Redis compartilhado de 10 chamadas por minuto e a consulta de pré-jogo existente. Há uma tentativa adicional com backoff para falhas transitórias de rede ou HTTP 5xx; 429 estabelece pausa compartilhada. A resposta do provedor com `x-ratelimit-requests-remaining: 0` bloqueia novas consultas para aquela modalidade até a próxima meia-noite UTC.

Como alternativa aos IDs manuais, configure `FOOTBALL_SYNC_DISCOVERY=true` e deixe `FOOTBALL_SYNC_FIXTURE_IDS` vazio. O worker consulta a agenda de futebol do dia UTC, seleciona partidas `NS` com início futuro e alterna até duas por rodada. O cursor fica no Redis e é compartilhado entre instâncias. A lista pode mudar entre rodadas, e uma falha em uma partida não é repetida imediatamente: ela volta a ser considerada na rotação. A descoberta consome a mesma cota compartilhada que as consultas de odds; com muitas partidas, não há garantia de atualização antes da expiração. Esse modo é experimental e permanece desativado por padrão.

Um lock Redis de três minutos impede rodadas simultâneas e uma geração transacional no PostgreSQL impede gravação de uma rodada anterior após outra assumir. As seleções ausentes ou partidas indisponíveis são suspensas; mudanças de preço mantêm o valor anterior e o horário da alteração. A expiração é o menor entre 60 segundos após a observação, 24 horas após a atualização do provedor e o início da partida. Sem horário válido do provedor ou início válido a seleção é considerada indisponível. A view calcula expiração na leitura e sempre retorna `bettable=false`; `GET /v1/sports/football/fixtures/:id/sync` é autenticado e retorna essa leitura. Erros de rede não renovam a validade. Contagens de solicitadas, concluídas e falhas ficam em `football_sync_runs` e no log.

Em 19/11/2026, uma execução manual com provedor real e a partida `1557467` gravou 14 seleções em `api_sports_test`, com `bettable=false`. O build, lint, 58 testes unitários/de integração e três testes e2e passaram. Os testes com PostgreSQL e Redis cobriram dois workers simultâneos, fencing, mudança de preço, expiração, suspensão e a rota HTTP. Para reproduzir, use um `DATABASE_TEST_URL` cujo nome de banco termine em `_test` e um `REDIS_TEST_URL` dedicado; os testes usam os bancos Redis 11 a 15 e removem suas próprias chaves. Não use Redis de produção para testes.

### Limitações antes de produção

- A descoberta opcional consulta a agenda do dia UTC e alterna lotes de até duas partidas futuras por rodada. Ela não cobre dias seguintes, não filtra ligas nem garante atualização de todas as partidas antes do início; uma agenda paginada é rejeitada. A opção manual continua limitada a três IDs.
- O limite conservador é de 10 chamadas por janela móvel de um minuto. Há reserva para requisições interativas e teto diário local opcional, mas respostas de cota no corpo e uso externo da chave não são integralmente gerenciados. O lock Redis não é renovado; o fencing protege gravações posteriores à troca de geração, mas a recuperação de falhas prolongadas precisa de mais testes.
- As métricas persistidas são contagens básicas por rodada, sem monitoramento completo ou retenção configurada. O teste real comprovou uma rodada, não a operação agendada prolongada.
- A API não alterou o `casino-api`, não integra bilhetes e não valida uma cotação para aceite. Todos os resultados continuam `bettable=false`; o worker não está pronto para ser a fonte operacional de apostas em produção.

## Integração local somente leitura — 19/11/2026

O ambiente de `compose.integration.yaml` usa cópias de `casino-api` e `casino-web` em `.tmp/sports-local`, PostgreSQL e Redis próprios, uma rede interna e chaves fictícias. Os processos de aplicação não têm saída para a internet. Apenas o gateway possui uma segunda rede, com portas vinculadas a `127.0.0.1`: frontend em `53003` e API de leitura do cassino em `53002`. O gateway recusa métodos diferentes de GET, HEAD e OPTIONS. A API esportiva usa `FOOTBALL_SYNC_ENABLED=false` e uma chave de provedor fictícia; o worker de teste usa respostas sintéticas em memória, sem acessar a API-Sports.

O `casino-api` isolado inicializa somente o controlador GET existente de `/sportsbook`, sem `BetModule`, cron ou rotas financeiras. Uma prévia experimental adicionada à cópia consulta a rota central existente de partidas sincronizadas, cruza `externalId`, horário e tipo de seleção e mantém os UUIDs locais. Na página existente de partida, usa preços centrais válidos apenas para exibição; a partida e todas as seleções permanecem bloqueadas. Resposta ausente, expirada ou inconsistente mantém os valores locais bloqueados. O interceptor do servidor de teste também bloqueia as demais leituras do sportsbook. O checkout original do cassino não foi alterado nem substituído; o diff revisável está em `local-integration/casino-preview.patch` e o adaptador em `local-integration/casino-files/`. Essa prévia **não está incorporada ao módulo de produção**.

### Reproduzir em PowerShell

Os caminhos padrão de origem são `C:\Users\andre\orca\casino-api` e `C:\Users\andre\orca\casino-web`; `prepare.ps1` aceita `-CasinoSource` e `-FrontendSource`. Ele recusa sobrescrever cópias existentes. Os clones usam `HEAD`: alterações não commitadas, inclusive as existentes no frontend, não são incluídas nem modificadas. Os Dockerfiles de teste excluem `.env`, `.git` e `node_modules` do contexto; não use os Dockerfiles originais para este cenário.

```powershell
.\local-integration\prepare.ps1
docker compose --env-file .env.integration -f compose.integration.yaml up -d --build postgres redis sports
.\local-integration\apply-sports-migration.ps1
docker compose --env-file .env.integration -f compose.integration.yaml exec -T postgres createdb -U sports_test casino_integration_test
docker compose --env-file .env.integration -f compose.integration.yaml exec -T postgres psql -U sports_test -d casino_integration_test -Atc 'SELECT current_database(), current_user'
docker compose --env-file .env.integration -f compose.integration.yaml build casino frontend
docker compose --env-file .env.integration -f compose.integration.yaml run --rm --no-deps casino npx prisma migrate deploy
Get-Content -Raw local-integration/casino-seed.sql | docker compose --env-file .env.integration -f compose.integration.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U sports_test -d casino_integration_test
docker compose --env-file .env.integration -f compose.integration.yaml up -d --no-build casino frontend gateway
docker compose --env-file .env.integration -f compose.integration.yaml exec -T -u root sports mkdir -p /app/scripts
docker cp scripts/integration-synthetic-worker.mjs sports-integration-local-sports-1:/app/scripts/integration-synthetic-worker.mjs
docker compose --env-file .env.integration -f compose.integration.yaml exec -T sports node /app/scripts/integration-synthetic-worker.mjs
docker cp scripts/integration-http-check.cjs sports-integration-local-casino-1:/tmp/integration-http-check.cjs
docker compose --env-file .env.integration -f compose.integration.yaml exec -T casino node /tmp/integration-http-check.cjs
```

O script de migration da API esportiva exige `sports_integration_test|sports_test`; o seed do cassino também verifica banco e usuário. A migration do cassino foi executada em `casino_integration_test`, após confirmar a conexão, e aplicou 145 migrations. Os dois bancos são descartáveis e não são os bancos previamente usados no Compose de desenvolvimento. Para desfazer **somente este ambiente de teste**, depois de conferir o nome do projeto e entender que os dados sintéticos serão apagados, execute `docker compose --env-file .env.integration -f compose.integration.yaml down --volumes`. Não execute esse rollback contra outro Compose ou banco. Não há rollback automático para dados de produção.

### Evidências e pendências

- Em 23/11/2026, a API esportiva foi reconstruída no ambiente isolado e o fluxo sintético foi repetido: a leitura HTTP do consumidor exibiu 2,10, preservou o UUID local e manteve as seleções bloqueadas; requisição sem chave recebeu 401. A rota financeira não existe no servidor somente leitura (404). Este ensaio cobre futebol sintético, não mercados de jogador ou uma aposta real.
- O limite agregado de consultas ao provedor usa janela móvel de 60 segundos no Redis compartilhado: até 10 chamadas, incluindo tentativas adicionais, das quais o worker usa até seis; as demais ficam disponíveis para consultas interativas. Se o cabeçalho do provedor informar zero chamadas restantes por minuto para uma modalidade, novas chamadas a ela são pausadas por 60 segundos. `API_SPORTS_DAILY_LIMIT` permite definir um teto diário local por modalidade, com 20% reservado a consultas interativas; zero ou ausência desativa esse teto. É necessário configurá-lo de acordo com o plano, com margem para outras aplicações, que não são contabilizadas por este Redis. O teto local conta apenas chamadas feitas após sua ativação e não substitui a leitura da cota real do provedor. Todas as réplicas devem usar a mesma versão, configuração e Redis; versões anteriores não compartilham integralmente essa política.

- Quatro execuções manuais do worker sintético cobriram criação, alteração de 1,90 para 2,10, suspensão de seleção ausente e falha de provedor simulada. O teste de integração com PostgreSQL/Redis cobriu dois workers concorrentes, fencing e expiração.
- Pela rota HTTP existente do cassino, a odd local conservou o UUID e mostrou 2,10 com `bettable=false` e seleções bloqueadas. A API central sem chave retornou 401; `POST /bets/tickets` retornou 404 no servidor somente leitura e o gateway retorna 405 para POST. Bilhetes, transações e carteiras permaneceram com contagem zero no banco do cassino de teste.
- Expiração forçada, horário divergente entre APIs e Redis parado mantiveram a resposta bloqueada. Após reiniciar esportes, cassino e frontend, a leitura integrada voltou a funcionar. O frontend respondeu HTTP 200 na página de partida; não foi realizado teste visual ou de interação em navegador.
- A API esportiva passou build, lint, 58 testes unitários/de integração e três e2e no ambiente de teste. A cópia do cassino compilou; os 43 testes direcionados de `sportsbook.service` e `central-preview` e o lint dos arquivos alterados passaram. A suíte completa do cassino não foi executada. O lint completo sem `--fix` falhou principalmente pela interpretação de CRLF pelo Prettier no container Linux, além de erros existentes; não foi aplicada correção em massa.
- O frontend iniciou e respondeu HTTP 200, mas seu build isolado falhou porque `next/font` tentou baixar fontes do Google, bloqueadas pela rede interna. Seu lint falhou em erros existentes de `react/no-unescaped-entities`, entre outros avisos. A instalação de dependências reportou alertas de segurança no `npm audit` (82 no cassino e 38 no frontend, incluindo dependências de desenvolvimento); é necessária triagem antes de uso fora do laboratório.
- Ainda faltam testar a interface em navegador, a lista de jogos e demais rotas integradas, identidade dos participantes entre APIs, concorrência com usuários reais e a aplicação da integração no repositório original após revisão. A prévia experimental só integra a leitura de detalhe da partida; ela não é validação para apostar nem autorização de deploy.
