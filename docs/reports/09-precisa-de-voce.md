# Report 09 — O que precisa de você

> Fecho da sessão de execução autônoma (2026-07-04). Aqui está **o que já foi feito**, **o
> que está esperando você** (PRs a revisar + decisões), e **o backlog restante**. O objetivo
> era resolver o máximo sem você — o mínimo abaixo é o que só você pode destravar.

---

## 1. ✅ Já feito e LIVE em produção (mergeado nesta sessão)

Não precisa de nada de você — é só ciência do que mudou em `palpiteiro.live`:

| PR | O quê | Fecha |
|---|---|---|
| #456 | Reports da auditoria (`docs/reports/`) | — |
| #461 | **Base legal**: `/termos`, `/privacidade`, footer global (18+/CVV/disclaimer), consentimento no /signin, descrição raiz neutra | #431 #432 #433 |
| #457 | CTA de conversão + Wordmark linkado no `/p` | #444 |
| #458 | a11y: semântica honesta de tabs + hints alcançáveis no touch | #448 |
| #459 | Segurança: CRON_SECRET timing-safe + esquema http(s) em URL de notícia | #437 (parcial) |
| #460 | `/como-funciona`: seção "O Palpite" + glossário do registro-manchete | #447 |

**Repo atualizado:** o checkout local foi sincronizado pro `origin/main` (estava 15 commits
atrás). Sua edição local de `CONTEXT.md` era uma re-redação da entrada "Palpite compartilhado"
que **o `origin/main` já tinha committado** (#414) — ou seja, redundante (feita na árvore stale
antes daquela entrada existir). Fiquei com a versão committada. Se preferir sua redação, é só
reeditar `CONTEXT.md` (o conceito já está documentado lá).

---

## 2. 🔵 PRs ABERTOS esperando SUA revisão + merge

A partir de certo ponto da sessão, o merge autônomo passou a exigir revisão humana (guard do
harness) — o que é bom pros PRs sensíveis. Estão **verdes** (typecheck + lint + testes; build
onde aplicável), prontos pra mergear. Revise e faça o merge (auto-deploya pra prod):

| PR | O quê | Fecha | Nota de revisão |
|---|---|---|---|
| #462 | **Segurança**: rate-limit por IP no magic link (o único exploit CONFIRMADO) + headers de segurança HTTP | #435 #436 | Sem CSP (precisa nonce — ver §4). HSTS sem `preload` (reversível) |
| #463 | Linha de aviso de risco na Análise sóbria + fan-out | #434 | Firewall intacto (superfície sóbria, não a manchete) |
| #465 | **SEO**: robots.ts + sitemap.ts + emenda do middleware + metadata (title template/twitter/canonical) + JSON-LD | #439 #443 (avança #441) | Confere a regex do middleware (validada no PR). Resto do #441 (títulos absolutos, /signin noindex, generateMetadata do /match) fica de follow-up |
| #464 | Este report (09) | — | — |

> Depois de mergear #462 e a SEO: ambos tocam superfície pública; um `curl -I` rápido em
> prod confirma os headers (`X-Frame-Options`, `HSTS`) e o `/robots.txt`/`/sitemap.xml` (200,
> não 307).

---

## 3. 🟨 Decisões e ações que SÓ VOCÊ pode tomar

### Legal / identidade
- **Nome do controlador / entidade.** As páginas `/termos` e `/privacidade` (já no ar) usam
  "o Palpiteiro (projeto pessoal mantido por seu responsável)" + `contato@palpiteiro.live`. Se
  quiser mais robustez legal, decida: colocar seu **nome pessoal** como controlador, e/ou
  **constituir MEI/PJ** (necessário pra monetizar — ver report 07). Edite as páginas (data
  forward-only) quando decidir.
- **Consentimento implícito vs explícito.** Adotei o **implícito** (aceite ao entrar + links
  visíveis) — o default sancionado da sua ops-doc pra escala de amigos. Se quiser mais
  defensável, upgrade pra checkbox explícito de Termos (issue de UI trivial).
- **Exclusão de conta (LGPD).** Hoje o caminho é "manda e-mail que eu apago" (dito na
  `/privacidade`). Construir o self-serve precisa de um **ADR decidindo a estratégia**
  (anonimizar-e-manter vs cascade duro — as FKs `restrict` de ai_calls/predictions/palpite_sets
  bloqueiam delete ingênuo). Recomendação: anonimizar-e-manter (report 05 rec. 5). **Aprove a
  estratégia** e eu construo.

### Produção / flags (não consigo verificar/mexer no DB de prod daqui)
- **CLV capture** (`enableClvCapture`) — o melhor proxy de edge pode estar OFF em prod (report
  03 achado #5). Confirme o estado da flag em prod e ligue (regra sua: sem flag manual OFF).
- **NÃO ligue `enable_best_bet_fan_out`** até corrigir o rate-limit do fan-out (report 01
  achado #3 — 1 slot autoriza ~6 calls pagas). Está inerte hoje; o fix é pré-requisito do flip.

### Config / conteúdo (preciso de insumo seu)
- **Links sociais** (item 6, issue #455): a infra (`site_settings` singleton) precisa de ADR +
  **os links reais** (você tem Instagram/Twitter/Telegram?). Me passe os links e eu construo o
  seam + o footer.
- **Blog** (item 3/7, issue #454): posso construir toda a infra (app/blog + MDX + 1 post
  semente), mas **os posts são seus** de escrever. Aprove o ADR e eu levanto a fundação.

### Marca / jurídico (fora do código)
- **Busca no INPI** por "palpiteiro" (classes 9/41/42) — ver report 08. E, se for monetizar:
  **advogado de direito digital/apostas + MEI** antes (report 07 rec. 4).

### Arcos grandes (item 3 e item 4) — aprove antes de eu construir
- **#450 — ADR camada estatística Poisson** (item 3) e **#451 — ADR "Aposta livre"** (item 4).
  São os dois arcos maiores e mexem em caminhos de dinheiro/IA. Recomendo o **plan-gate de duas
  rodadas** (teu padrão pra pivots): eu escrevo o ADR → você revisa → eu ajusto → aí implemento.
  O motor Poisson (`lib/quant/scoreline-model.ts`, issue #452) é **compartilhado** pelos dois —
  construir uma vez. **Diga "vai" e eu começo pelos ADRs.**

---

## 4. 🟩 Follow-ups técnicos que eu deixei anotados (posso fazer, não bloqueiam)

- **#466 — delimitadores anti-prompt-injection** no prompt de síntese (`cartridge.ts`),
  o restante do #437 (já fechado). Deixei de fora do PR de segurança por ser superfície
  firewall-sensível; faço num PR dedicado com revisão cuidadosa.
- **CSP → #467** (report 01 #2): os headers de segurança foram (#462), mas CSP ficou de fora — precisa
  de nonce ou report-only por causa dos scripts inline do Next + túnel Sentry. Follow-up cuidadoso.
- **next.config cache-lookahead → #468** pra ícones/robots (ADR 0024, item obrigatório do #439):
  adiei pra não conflitar com o #462 (ambos tocam next.config). Fazer depois que #462 mergear.
- **Ícones + manifest + OG image da landing** (#440, #442): deixei como issues — são
  **design-sensíveis** e ganham com o teu /impeccable. A OG image é alto valor pra unfurl.
- **#438 — re-auditar a `/p/[id]`**: a rota de share (shipada) não foi coberta pela auditoria
  de segurança (o agente leu a árvore stale). Review dedicado contra os invariantes do ADR 0035.

---

## 5. Backlog completo (issues criadas)

25 issues: **#431–#455**. As de Onda 0 estão quase todas feitas/em-PR (acima). Restantes por onda:

- **Onda 0 restante:** #440 (ícones), #442 (OG image), #445 (copy-debt), #446 (empty-state), #438 (re-audit /p), #466 (delimitadores, ex-#437), #467 (CSP), #468 (cache-lookahead), #469 (hardening rate-limit), #449 (tokens palpite-* no DESIGN.md).
- **Onda 1 (item 4):** #451 (ADR), #452 (Poisson), + downstream do ADR.
- **Onda 2 (item 3):** #450 (ADR), #453 (calibração), #452 (Poisson, compartilhado).
- **Onda 3 (crescimento):** #454 (blog), + UX de retenção (report 02: digest, track record, dashboard mobile, seguir times).
- **Onda 4 (monetização):** #455 (social links), + report 07 (instrumentação, doações, Pro).

## Como retomar
Quando voltar: (1) revise + mergeie os PRs abertos (§2); (2) me diga quais decisões de §3
topou e quais arcos aprovar; (3) me passe os insumos (links sociais, go/no-go dos ADRs). O
resto eu toco. Kickoff pronto no fim da mensagem da sessão.
