# Integração da API esportiva com o casino-api

Este documento descreve a interface atualmente implementada. A API esportiva fornece dados; o consumidor mantém suas próprias partidas, bilhetes, saldos e regras de apuração. **Odds e mercados retornados pela API são prévias e não autorizam aceitar apostas.**

## Endereço e autenticação

Em desenvolvimento, a API esportiva deste computador escuta em `http://127.0.0.1:53000`. Esse endereço é válido para um processo no mesmo computador. Um contêiner não acessa o host pelo próprio `127.0.0.1`: use um endereço alcançável a partir do contêiner ou o nome do serviço em uma rede Docker compartilhada. O laboratório isolado deste repositório usa `http://sports:3000`.

Configure no servidor consumidor, fora do código-fonte:

```dotenv
SPORTS_API_URL=http://127.0.0.1:53000
SPORTS_API_KEY=<chave-exclusiva-do-consumidor>
```

Esses nomes são uma sugestão para a integração definitiva; a prévia experimental existente usa `SPORTS_PREVIEW_URL` e `SPORTS_PREVIEW_KEY`. Gere uma chave com `pnpm key:generate` no projeto esportivo e cadastre-a no objeto JSON `API_CLIENTS` da API esportiva, associada a um identificador exclusivo. Reinicie a API esportiva após alterar essa configuração. Não coloque a chave no frontend nem no repositório.

Todas as rotas abaixo exigem `x-api-key`. Exemplo no PowerShell, com as variáveis configuradas no processo:

```powershell
Invoke-RestMethod -Uri "$env:SPORTS_API_URL/v1/provider-catalog" -Headers @{ 'x-api-key' = $env:SPORTS_API_KEY }
```

## Rotas

| Método e rota | Uso |
| --- | --- |
| `GET /v1/provider-catalog` | Catálogo estático de capacidades do provedor. |
| `GET /v1/sports/:sport/events?date=AAAA-MM-DD` | Agenda e observações de resultados para uma modalidade e data. |
| `GET /v1/sports/football/fixtures/:id/odds` | Consulta sob demanda de odds pré-jogo de futebol, como prévia. |
| `GET /v1/sports/football/fixtures/:id/sync` | Última leitura persistida pelo worker de futebol, como prévia. |
| `GET /v1/sports/basketball/games/:id/player-markets` | Mercados individuais de jogadores de basquete, como prévia. |
| `GET /v1/sports/basketball/games/:id/player-board` | Tudo de um jogo agrupado por jogador: linhas, odds por casa e estatísticas do jogo. |

Os identificadores aceitos em `:sport` são `football`, `basketball`, `baseball`, `hockey`, `handball`, `rugby`, `volleyball`, `american-football`, `mma`, `afl`, `formula-1` e `nba`. `nba` é resolvido para basquete e retorna `sport: "basketball"`. O catálogo estático lista as modalidades multisport e suas capacidades; futebol também é aceito na rota de agenda, mas não aparece nesse catálogo.

### Agenda

```http
GET /v1/sports/football/events?date=2026-11-23
x-api-key: <chave>
```

O envelope é `{ "sport": "football", "date": "2026-11-23", "observedAt": "...", "events": [...] }`. No futebol, cada evento contém `externalId` numérico em texto, `league`, `home`, `away`, `startTime`, `status`, `goals`, `score` e `observedAt`. Em outras modalidades, os eventos têm formato diferente, incluindo `externalId` no padrão `apisports:<modalidade>:<id>`, `providerId`, `sportId`, `phase`, `startTime`, participantes e dados de resultado quando disponíveis. A agenda é cacheada por 30 segundos; o horário de observação do cache é preservado. Uma agenda que não possa ser interpretada integralmente ou venha paginada é rejeitada.

`settlementReady`, quando presente em modalidades multisport, indica apenas que o resultado normalizado parece inequívoco. Não é confirmação definitiva nem autorização para liquidar.

### Odds de futebol sob demanda

```http
GET /v1/sports/football/fixtures/1557467/odds
x-api-key: <chave>
```

O ID é o identificador numérico da partida no provedor. A resposta contém `fixtureId`, `bookmakerId`, `status`, `startTime`, `observedAt`, `providerUpdatedAt`, `selections`, `bettable` e `reason`. Cada seleção contém `type`, `category`, `name` e `value`. Os grupos atualmente mapeados são resultado, totais de 1,5/2,5/3,5 gols, dupla chance e ambas marcam. A lista pode ser vazia. A casa é configurada na API esportiva; o padrão é ID 8. O cache dura 15 segundos.

`bettable` é sempre `false`. `reason` pode ser `PREVIEW_ONLY`, `ODDS_UNAVAILABLE` ou `MATCH_UNAVAILABLE`. Não use esses preços para aceitar bilhetes.

### Odds de futebol persistidas

```http
GET /v1/sports/football/fixtures/1557467/sync
x-api-key: <chave>
```

Retorna `fixtureId`, `status`, `startTime`, `observedAt`, `selections` e `bettable: false`. Cada seleção usa os nomes `bookmaker_id`, `market_group`, `selection_type`, `name`, `price`, `previous_price`, `price_changed_at`, `observed_at`, `provider_updated_at`, `expires_at`, `unavailable` e `bettable`. Valores `price` e `previous_price` podem ser strings decimais ou `null` conforme o campo. A disponibilidade é calculada na leitura; trate como indisponível se `unavailable` for `true`, o prazo tiver expirado, a resposta falhar ou qualquer informação necessária for inconsistente. O worker atual não sincroniza todas as partidas: a descoberta local cobre apenas partidas futuras do dia UTC, em lotes pequenos. Uma partida não sincronizada retorna 404.

### Jogadores de basquete

```http
GET /v1/sports/basketball/games/123456/player-markets
x-api-key: <chave>
```

O ID deve ser o `providerId` numérico do evento de basquete, não o `externalId` com prefixo. Exemplo ilustrativo de formato; os valores não são cotações reais:

```json
{
  "gameId": "123456",
  "observedAt": "2026-11-23T12:00:00.000Z",
  "selections": [{
    "bookmakerId": 4,
    "bookmaker": "Example",
    "providerMarketId": 117,
    "providerMarketName": "Player Points",
    "playerName": "Jogador Exemplo",
    "team": null,
    "statistic": "points",
    "side": "over",
    "line": 9.5,
    "odd": 1.76,
    "providerLabel": "Jogador Exemplo - Over 9.5",
    "overtimeIncluded": null,
    "providerUpdatedAt": null
  }],
  "bettable": false,
  "reason": "RULES_AND_PRICE_VALIDATION_REQUIRED",
  "combinationPricing": "UNAVAILABLE"
}
```

As estatísticas mapeadas são `points`, `rebounds` e `assists`; `side` é `over` ou `under`. `team` pode ser `home`, `away` ou `null`. O nome não é um identificador confiável de jogador, e `overtimeIncluded: null` significa regra desconhecida. Podem existir várias casas ou nenhuma seleção. O cache dura 30 segundos, mas isso não garante que o preço original seja recente: confira `providerUpdatedAt`, que pode ser `null`.

A API ainda não fornece cotação combinada para seleções correlacionadas no mesmo jogo, identidade confirmada de jogador ou regras de prorrogação e apuração. Não multiplique as odds individuais para inventar a cotação de “Criar Aposta”.

### Quadro de jogadores por jogo

```http
GET /v1/sports/basketball/games/123456/player-board
```

Junta numa resposta os mercados de `player-markets` e as estatísticas do jogo (`/games/statistics/players`), agrupados por jogador, para o frontend montar o bilhete:

```json
{
  "gameId": "123456",
  "oddsObservedAt": "2026-11-25T20:00:00.000Z",
  "statisticsObservedAt": "2026-11-25T20:00:01.000Z",
  "statisticsError": null,
  "players": [
    {
      "name": "Jogador Exemplo",
      "playerId": "10",
      "teamId": "1",
      "team": "home",
      "statistics": { "minutes": "34:12", "points": 22, "rebounds": 9, "assists": 4 },
      "selections": [
        {
          "selectionId": "3f1c...",
          "statistic": "points",
          "side": "over",
          "line": 20.5,
          "bestOdd": 1.95,
          "prices": [{ "bookmakerId": 2, "bookmaker": "Casa B", "providerMarketId": 117, "odd": 1.95, "providerLabel": "Jogador Exemplo - Over 20.5", "providerUpdatedAt": null }]
        }
      ]
    }
  ],
  "bettable": false,
  "combinationPricing": "UNAVAILABLE"
}
```

- `selectionId` é estável entre leituras do mesmo jogo (serve para guardar a seleção no bilhete), mas não é identificador de aposta.
- `statistics` é `null` antes do jogo ou quando o nome da casa não bate com exatamente um jogador; nesse caso `playerId` também é `null`. Jogadores com estatísticas e sem linhas aparecem com `selections: []`.
- Se a consulta de estatísticas falhar, as odds continuam vindo e `statisticsError` vale `STATISTICS_UNAVAILABLE`.
- Odds e estatísticas ficam 30 segundos em cache. Sem cache, cada leitura gasta até duas requisições ao provedor.
- Valem as mesmas restrições de `player-markets`: não há cotação combinada para seleções do mesmo jogo.

## Identidade, falhas e limites

- Preserve os UUIDs locais existentes; relacione registros esportivos pelo identificador externo e confirme partida, participantes, horário e mercado antes de atualizar qualquer dado.
- As rotas protegidas limitam cada consumidor a 120 requisições por minuto, compartilhadas entre instâncias que usem o mesmo Redis. A API esportiva também controla as chamadas ao provedor, portanto pode retornar 503 mesmo abaixo do limite do consumidor.
- `400` indica parâmetros inválidos; `401`, chave ausente ou inválida; `404`, partida sincronizada não encontrada; `429`, limite do consumidor; `502`, falha ou resposta inválida do provedor; `503`, indisponibilidade, consulta em andamento ou limite temporário. Trate falhas com backoff e jitter limitado, sem repetição agressiva. Uma lista vazia não comprova que há cobertura para o jogo.
- Em caso de falha, inconsistência ou expiração, mantenha as seleções bloqueadas. Não atualize o horário de observação ao reutilizar dados em cache e não confunda `observedAt` com atualização do provedor.
- Estas rotas não implementam confirmação de preço no aceite, liquidação, reconciliação de resultados, cotação de combinações ou operação completa de todos os mercados. Preserve essas responsabilidades no consumidor até que haja implementação e validação específicas.

## Laboratório existente

O ambiente `compose.integration.yaml` usa bancos e chaves fictícios e uma cópia isolada do consumidor. A prévia nele implementada lê apenas o detalhe de uma partida de futebol, mantendo UUIDs e seleções bloqueadas. Não integra os mercados de basquete nem altera o repositório original. Os comandos e resultados estão em [migracao-esportes.md](migracao-esportes.md).
