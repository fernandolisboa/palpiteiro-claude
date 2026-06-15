-- Liga as linhas EXTRAS de over/under (1.5/3.5 via o cartucho multi-linha
-- over_under_v3.0) pra TODOS os usuários (#175). Decisão do dono (2026-06-14):
-- disponível ASAP, sem soak admin-only.
--
-- Flip data-driven do feature-flag (sem deploy de código): a row id=1 é garantida
-- pela 0004 (INSERT ON CONFLICT DO NOTHING), então um UPDATE simples basta — sem
-- upsert. A análise multi-linha só roda onde há cobertura de alternate_totals
-- (OVER_UNDER_ALT.coveredLeagues = ['world_cup']); demais ligas seguem featured 2.5.
-- Reversível: SET ... = false.
UPDATE "ai_config" SET "enable_over_under_extra_lines" = true WHERE "id" = 1;
