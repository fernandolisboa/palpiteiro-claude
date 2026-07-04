# Report 02 — UI/UX e novas funcionalidades

> Auditoria de UX + ideias de funcionalidade (2026-07-04), aterrada nas superfícies reais de
> `origin/main`. Respeita PRODUCT.md (dois registros: motor de valor sóbrio + palpite
> chamativo), DESIGN.md (tokens/primitivas — não cunhar tokens novos) e o firewall de
> linguagem de valor.

## Veredito geral

As superfícies centrais estão **fortes**: a match page acerta os dois registros (hero de
palpite quente + análises por mercado sóbrias e colapsáveis), estados quase todos explícitos,
tokens/primitivas usados com disciplina, e os arcos novos (share `/p/[id]`, `/time`,
grade-my-bet, badges ao vivo) aterrissaram limpos.

**O takeaway nº 1:** o **palpite — o registro-manchete do produto — é invisível fora da
match page.** `/jogos` é odds-first, o dashboard só trackeia o motor de valor, e não existe
track-record agregado de palpite, nem "palpites de hoje", nem lembrete, nem seguir-times. O
loop "no sofá antes do apito" que justifica o produto **não tem gancho de re-entrada.**

## Achados (prioridade)

| # | Prioridade | Achado |
|---|---|---|
| 1 | **alta** | Palpite invisível fora da match page — sem digest, sem presença na lista, sem track record agregado |
| 2 | **alta** | Dashboard **não é mobile-first**: shell desktop + tabela de 10 colunas com scroll no celular (viola PRODUCT.md princípio 3) |
| 3 | média | `/p/[id]` (share) é **beco sem saída de conversão** — nenhum caminho de volta pro app |
| 4 | média | `/como-funciona` **nunca explica o palpite** — só o motor de valor (edge/PASS/overround/stake/yield) |
| 5 | média | Metadata raiz é copy pré-pivot ("Recomendações de aposta em over/under 2.5") e cascateia pra toda página autenticada |
| 6 | média | Copy stale/incoerente: subtítulo "over/under 2.5", "Copa do Mundo FIFA 2026" hardcoded, skeleton "Próximas 48h", labels tipster "green/red" |
| 7 | média | Landing = um parágrafo abstrato ("motor de seleção de edge multi-mercado"), sem prova de produto pra conversão |
| 8 | média | Lacunas de empty-state: tablist sobre painel vazio, empty de recents em texto cru, back-label errado vindo de `/time` |
| 9 | baixa | a11y: tabs sem `aria-controls`/roving-tabindex/arrow-keys; hint de baixa-amostra só em `title` (inalcançável no touch) |
| 10 | baixa | DESIGN.md não documenta a família de tokens `palpite-*` (terracota hue 40) |

Evidência-chave: `components/match-row.tsx:45-50`, `components/recent-pred-card.tsx:33-49`,
`app/dashboard/page.tsx:62`, `components/dashboard/predictions-table.tsx:64-75`,
`app/p/[id]/page.tsx:74-79` (origin/main), `app/layout.tsx:18-22`, `app/landing-content.tsx:19-62`.

## Recomendações (dimensionadas)

### Alto impacto
1. **"Palpites de hoje" no `/jogos` + presença de palpite nas rows** · M · sem ADR
   Query nova batch (último set por match) → rail horizontal de mini-cards quentes
   (veredito + palavra de confiança + kickoff, tudo firewall-safe) + chip "tem palpite" na
   `MatchRow`. **Zero gasto novo de IA** (só lê sets persistidos). Reusa tokens `palpite-*` e `SettleableBadge`.
2. **Track record do palpite ("o placard do Palpiteiro")** · M · sem ADR
   Agrega linhas settled (placar cravado / resultado) num tally honesto, por usuário e
   global. Card no registro brincalhão no `/dashboard`, separado do grid sóbrio de KPI.
   Aterra a promessa de PRODUCT.md ("never lies about its own track record"), hoje só por-badge.
3. **Digest de e-mail opt-in pré-apito ("hoje tem jogo")** · L · **ADR**
   Primeiro canal outbound ao usuário. Toggle no `/perfil` + cron diário via seam Resend,
   manda os jogos do dia (no fuso do usuário) com palpite (só a manchete). O ADR fixa
   regras de conteúdo (headline-only, disclaimer + 18+), storage do opt-in, política de horário.
4. **Dashboard mobile pass** · M · sem ADR
   Espelhar o padrão `/jogos` (`lg:hidden`/`hidden lg:block`): `PageHeader`+`MobileNav` no
   mobile + lista de cards-por-predição no lugar da tabela de 10 colunas. Corrige a violação
   mobile-first na única superfície que a ignora.
5. **CTA de conversão no `/p` + Wordmark linkado** · S · sem ADR
   Wrap do Wordmark num `Link` pra `/` + CTA discreto no footer ("Peça o palpite do seu jogo
   →"). **O fix de crescimento mais barato do app** — hoje todo unfurl de WhatsApp morre ali.
   Firewall-safe por construção (registro muted, zero linguagem de valor). *(Cruza com o Report 06.)*

### Médio impacto
6. **Seguir times** · M · sem ADR — tabela `followed_teams`, toggle estrela em `/time` + hero, filtro "meus times" no `/jogos`, prioridade no digest.
7. **PR de dívida de copy** · S · sem ADR — descrição raiz palpite-first + títulos por rota; subtítulo dashboard multi-mercado; remover/derivar "Copa do Mundo FIFA 2026"; skeleton range-neutral; remover eyebrow `match · {uuid8}`; `green/red` → `ganhou/perdeu` (ou `acertou/errou`). **Auditar goldens de class-string antes** (landmine conhecido).
8. **Seção "O Palpite" no `/como-funciona` + glossário** · S · sem ADR — explicar o registro brincalhão (confiança, placar provável ≠ odd, dimensões "e ainda", acertou/errou, "o palpite leu" fontes, o disclaimer). Deep-link do hero via HelpHint.
9. **Enriquecer a landing** · M · sem ADR — mantendo 100% estática (contrato #373): card de palpite exemplo hardcoded (firewall-clean) + tira "como funciona" em 3 passos + uma linha de honestidade. Destino do funil `/p`.
10. **Polish de empty-state/first-run** · S · sem ADR — `EmptyState` + CTA nos recents; não renderizar o tablist sobre painel nulo; derivar o back-label da base resolvida.

### Baixo impacto
11. **Histórico de palpite na match page ("palpites anteriores")** · S — `getPalpiteSetsForMatch` já traz o histórico, mas a UI só renderiza `sets[0]`; um re-run descarta silenciosamente o palpite anterior (esconder ≈ mutar).
12. **a11y touch-ups** · S — semântica de tabs; mover hint de baixa-amostra pro popover `HelpHint`; `sr-only` no tab desabilitado.
13. **Documentar `palpite-*` no DESIGN.md** · S — parágrafo "Terracota" espelhando o de `edge-*`, com a nota never-casino-loud.

## Síntese
As melhorias de maior alavancagem giram todas em torno de **dar presença ao palpite fora da
match page** e **fechar o loop de re-entrada** (digest, track record, seguir times, CTA no
share). São quase todas **zero-gasto-de-IA** (leem dados já persistidos) e firewall-safe.
O #5 (CTA no `/p`) é o melhor custo-benefício isolado do app.

Relacionados: PRODUCT.md, DESIGN.md, ADR 0030/0031 (firewall), ADR 0035 (share).
