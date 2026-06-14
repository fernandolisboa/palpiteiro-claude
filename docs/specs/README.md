# docs/specs — Specs de prompt por mercado

Contratos formais de entrada/saída dos cartuchos de prompt do Palpiteiro (LLM como motor de seleção de edge
multi-mercado). Estrutura: uma **spec-mãe** genérica + uma **spec por mercado** que a instancia.

- **[cartridge-prompt-contract.md](./cartridge-prompt-contract.md)** — **spec-mãe**: o contrato genérico de
  cartucho (fronteira LLM↔`predict.ts`, edge N-vias normalizado, pass-first + floor, tolerância Zod vs tool
  schema, staking, settlement, versionamento + replay-eval **pago**, três vocabulários,
  expand-migrate-contract). **Leia primeiro.** Cobre ADRs 0015–0019 (+ 0012-cenários).

| Mercado | Spec | Status | Seleções | Linha | Cartucho |
| --- | --- | --- | --- | --- | --- |
| Over/Under | [over-under-prompt-design.md](./over-under-prompt-design.md) | **ATIVO** | `over`/`under` (N=2) | sim (`line`) | `over_under_v2.0` |
| 1X2 (resultado) | [match-result-prompt-design.md](./match-result-prompt-design.md) | planejado (#173) | `home`/`draw`/`away` (N=3) | não | `match_result_v1` (a confirmar) |
| BTTS (ambas marcam) | [btts-prompt-design.md](./btts-prompt-design.md) | planejado (#174) | `yes`/`no` (N=2) | não | `btts_v1` (a confirmar) |
| Dupla chance | [double-chance-prompt-design.md](./double-chance-prompt-design.md) | planejado (#176) | `home_or_draw`/`away_or_draw`/`home_or_away` (N=3) | não | `double_chance_v1` (a confirmar) |

As specs **planejadas** são o contrato de design que as issues do pivot (Fase 4) implementam; ao aterrissar
cada cartucho, reconciliar a versão real + paths na sua spec. Ativar um mercado é registrar nas fronteiras
keyed (cartucho + descriptor + apresentação + settlement) + seed + flag — **nunca** ramificar o runtime
(`if (market === X)`; ADR 0015-D7).
