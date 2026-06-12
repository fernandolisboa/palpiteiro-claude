# Entity-Relationship — Palpiteiro

Diagrama do schema definido em [`db/schema.ts`](../../db/schema.ts). Cardinalidades estão em notação Mermaid (crow's foot). O diagrama reflete o **modelo de domínio multi-mercado** do pivot (ADRs [0015](../decisions/0015-modelo-dominio-multi-mercado.md)/[0016](../decisions/0016-settlement-por-mercado.md)): `markets`/`market_selections` como tabelas de referência, `predictions` referenciando `market_id`/`selection_id`/`market_params`, e odds genéricas por seleção. A base mono-mercado vinha da migration `0000_same_molten_man.sql` (issue #4).

> **Expand-migrate-contract (ADR 0015 D5):** durante a migração, o enum `market` (em `predictions` **e** `match_odds_snapshots`) **coexiste** com `market_id` até a fase de **contract**. O par fixo `over_odd`/`under_odd_at_prediction` em `predictions` (ADR 0012, nullable) é mantido como **legado** até lá; as odds passam a ser modeladas genericamente por seleção (`selection_odds_snapshots`). `prediction_outcomes.total_goals` vira **derivado** (`home_score + away_score` em `result_data`) e mantido por compat; `outcome_result` ganha `push` (ADR 0016).

```mermaid
erDiagram
    USERS ||--o{ PREDICTIONS : "creates"
    USERS ||--o{ AI_CALLS : "triggers"
    USERS ||--o{ PREDICTION_OUTCOMES : "overrides (optional)"

    MATCHES ||--o{ PREDICTIONS : "analyzed in"
    MATCHES ||--o{ AI_CALLS : "subject of"
    MATCHES ||--o{ MATCH_ODDS_SNAPSHOTS : "priced by"

    AI_CALLS ||--o| PREDICTIONS : "produces"

    PREDICTIONS ||--|| PREDICTION_OUTCOMES : "settled by"

    MARKETS ||--o{ MARKET_SELECTIONS : "offers"
    MARKETS ||--o{ PREDICTIONS : "scoped by"
    MARKET_SELECTIONS ||--o{ PREDICTIONS : "selected in (optional)"

    USERS {
        uuid id PK
        text email UK
        text name
        user_role role
        boolean allowed
        timestamptz created_at
    }

    MATCHES {
        uuid id PK
        text external_id UK
        league league
        text home_team
        text away_team
        timestamptz kickoff_at
        match_status status
        integer home_score
        integer away_score
        timestamptz updated_at
    }

    MARKETS {
        uuid id PK
        text key UK
        text label
        text settlement_rule_key
        boolean active
        boolean graduated
        timestamptz created_at
    }

    MARKET_SELECTIONS {
        uuid id PK
        uuid market_id FK
        text key
        text label
        integer sort_order
    }

    MATCH_ODDS_SNAPSHOTS {
        uuid id PK
        uuid match_id FK
        text bookmaker
        uuid market_id FK
        uuid selection_id FK
        jsonb market_params
        numeric odd
        numeric overround_pct
        timestamptz captured_at
    }

    AI_CALLS {
        uuid id PK
        uuid user_id FK
        uuid match_id FK
        ai_provider provider
        text model
        text prompt_version
        jsonb input_payload
        jsonb output_payload
        integer input_tokens
        integer output_tokens
        integer latency_ms
        numeric cost_usd
        timestamptz created_at
    }

    PREDICTIONS {
        uuid id PK
        uuid match_id FK
        uuid user_id FK
        uuid ai_call_id FK
        uuid market_id FK
        uuid selection_id FK
        jsonb market_params
        numeric confidence_pct
        text rationale
        text_array key_factors
        numeric minimum_odd
        numeric odd_at_recommendation
        text bookmaker
        numeric implied_prob_pct
        numeric edge_pct
        numeric stake_units
        text model_version
        text prompt_version
        timestamptz created_at
        numeric over_odd_at_prediction
        numeric under_odd_at_prediction
    }

    PREDICTION_OUTCOMES {
        uuid id PK
        uuid prediction_id FK_UK
        jsonb result_data
        integer total_goals
        outcome_result result
        numeric profit_units
        uuid override_by_user_id FK
        timestamptz settled_at
    }
```

## Política de ON DELETE

Princípio: predições e ai_calls são history imutável. Snapshots e outcomes são derivados do registro pai. Usuários nunca podem ser apagados silenciosamente sem revisão.

| FK | ON DELETE | Por quê |
|---|---|---|
| `match_odds_snapshots.match_id` → `matches.id` | CASCADE | Snapshot só faz sentido com o match. |
| `ai_calls.user_id` → `users.id` | RESTRICT | Audit log de custo/uso por usuário é imutável. |
| `ai_calls.match_id` → `matches.id` | RESTRICT | Audit log órfão não pode ser silenciosamente perdido. |
| `predictions.match_id` → `matches.id` | RESTRICT | Yield history exige match presente. |
| `predictions.user_id` → `users.id` | RESTRICT | Yield por usuário sobrevive a delete; usar `allowed=false` pra soft-delete. |
| `predictions.ai_call_id` → `ai_calls.id` | RESTRICT | Toda predição precisa do seu audit log. |
| `prediction_outcomes.prediction_id` → `predictions.id` | CASCADE | Outcome só existe enquanto a predição existir. (`UNIQUE` garante 1:1.) |
| `prediction_outcomes.override_by_user_id` → `users.id` | SET NULL | Override é metadado; sobrevive ao delete do autor com pointer nulo. |
| `market_selections.market_id` → `markets.id` | CASCADE | Seleção só faz sentido com o mercado pai. |
| `predictions.market_id` → `markets.id` | RESTRICT | Yield history exige o mercado presente (catálogo é seed/migration, não deletável em uso). |
| `predictions.selection_id` → `market_selections.id` | RESTRICT | Seleção congelada na predição; nullable em `pass`. |
| `match_odds_snapshots.market_id` → `markets.id` | RESTRICT | Snapshot referencia o catálogo de mercados. |

## Notas

- `text_array` representa `text[]` (array nativo do Postgres) — Mermaid não tem tipo array dedicado.
- Enums (`user_role`, `league`, `match_status`, `outcome_result`, `ai_provider`) são `pgEnum` nativos. Lista de valores em `db/schema.ts`. `outcome_result` ganha `push` no pivot (ADR 0016).
- `markets`/`market_selections` substituem os enums `market`/`recommendation` por **tabelas de referência** (seed + FK), evitando `ALTER TYPE ADD VALUE` a cada mercado/seleção (ADR 0015 D3). Os enums `market`/`recommendation` antigos seguem no schema até o **contract** (expand-migrate-contract).
- `market_params`/`result_data` são JSONB validados por Zod no boundary (ADR 0015 D4); o agregável (Yield/edge/stake/result) fica em colunas tipadas.
- Índices não-PK/UK: `matches.kickoff_at`, `predictions.match_id`, `predictions.user_id`, `predictions.created_at`, `predictions.market_id`, `ai_calls.created_at`, `ai_calls.user_id`, `match_odds_snapshots.match_id`, `market_selections.market_id`.
