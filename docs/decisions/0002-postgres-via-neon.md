# ADR 0002 — PostgreSQL via Neon como banco de dados

## Status
Accepted (2026-05)

## Contexto

Preciso de banco pra armazenar usuários, jogos, predições, audit log de chamadas de IA, e snapshots de odds. Volume esperado é baixo na Fase 1 (centenas de linhas) e médio na Fase 2 (milhares de predições + dezenas de milhares de odds snapshots).

Casos de uso predominantes:
- Inserts frequentes com schema bem definido
- Queries analíticas ad-hoc pro dashboard (Yield por liga, por dia, etc.)
- JOINs entre predições, jogos, outcomes
- Audit log com payloads JSON (input/output do LLM)

## Decisão

PostgreSQL hospedado no **Neon**.

## Razão

1. **Postgres**: SQL padrão, JSON nativo (`jsonb` pra audit logs flexíveis), excelente pra analytics ad-hoc — que é exatamente o caso de uso do dashboard
2. **Neon**: serverless, free tier generoso (3 GB, autoscale, branching), branching de DB facilita testes destrutivos sem medo
3. **Compatibilidade Drizzle**: ORM escolhido funciona perfeitamente com `@neondatabase/serverless`
4. **Familiaridade**: já trabalho com Postgres regularmente
5. **Edge-friendly**: driver serverless do Neon roda em Edge runtime se eu precisar (Vercel)

## Alternativas consideradas

- **Supabase**: bom, mas traz auth/storage/realtime que não preciso aqui; preferi não acoplar
- **Vercel Postgres**: mais caro pro mesmo recurso; menos flexível em branching
- **SQLite (Turso)**: tentação pra MVP pequeno, mas perde analytics ad-hoc complexas; menos operadores de janela; analytics seria dolorosa
- **MongoDB**: rejeitada — analytics relacional + agregações complexas são o coração do produto

## Consequências

- (+) Free tier cobre Fase 1+2 com folga
- (+) Branching de DB pra testar migrations sem medo
- (+) Analytics ad-hoc poderosa via SQL
- (−) Cold start em queries (mitigado por connection pooling do Neon)
- (−) Latência marginalmente maior que DB local (irrelevante pro use case)
