# Entity-Relationship — Palpiteiro

Diagrama do schema definido em [`db/schema.ts`](../../db/schema.ts). Reflete a migration `0000_same_molten_man.sql` (issue #4). Cardinalidades estão em notação Mermaid (crow's foot).

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

    MATCH_ODDS_SNAPSHOTS {
        uuid id PK
        uuid match_id FK
        text bookmaker
        market market
        numeric line
        numeric over_odd
        numeric under_odd
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
        market market
        recommendation recommendation
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
    }

    PREDICTION_OUTCOMES {
        uuid id PK
        uuid prediction_id FK_UK
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

## Notas

- `text_array` representa `text[]` (array nativo do Postgres) — Mermaid não tem tipo array dedicado.
- Enums (`user_role`, `league`, `match_status`, `market`, `recommendation`, `outcome_result`, `ai_provider`) são `pgEnum` nativos. Lista de valores em `db/schema.ts`.
- Índices não-PK/UK: `matches.kickoff_at`, `predictions.match_id`, `predictions.user_id`, `predictions.created_at`, `ai_calls.created_at`, `ai_calls.user_id`, `match_odds_snapshots.match_id`.
