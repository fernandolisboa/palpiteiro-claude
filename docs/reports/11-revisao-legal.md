# Report 11 — Revisão legal e de conformidade (o que está no ar)

> Revisão de 2026-09-24 sobre `origin/main` (`a87baf5`) + as correções deste branch. O dono
> **delegou a revisão e a aprovação**; não houve advogado. Por isso este report **decide**
> em vez de listar dúvidas: cada item traz o veredito e a decisão. As decisões estruturais
> viraram ADRs: [0046](../decisions/0046-exclusao-de-conta-lgpd-tombstone-e-anonimizacao.md)
> (exclusão de conta), [0047](../decisions/0047-consentimento-clickwrap-e-base-legal-lgpd.md)
> (aceite e base legal), [0048](../decisions/0048-envelope-regulatorio-nao-operador-sem-vinculo-com-casas.md)
> (não-operador, sem vínculo com casas). O que só o dono pode fazer está na §3.
>
> Citações: **(V)** = conferida na fonte primária nesta sessão (planalto.gov.br);
> **(V2)** = conferida em fonte secundária; **(NV)** = não verificada, conferir depois
> (lista completa na §5).

## 1. Veredito geral

A base que o #461 pôs no ar (páginas legais, footer global, gate 18+, avisos de risco) está
**no lugar certo** e o enquadramento está correto: o Palpiteiro **não é agente operador**
(Lei 14.790/2023 art. 2º (V)), não precisa de autorização da SPA nem de `.bet.br`, e não
tem link, anúncio ou comissão de casa nenhuma. O risco regulatório de apostas é baixo e
fica baixo enquanto a vedação do ADR 0048 valer.

Os problemas reais estavam na **LGPD**, e eram de substância, não de forma:

1. **Exclusão prometida e impossível.** A `/privacidade` prometia excluir, mas o schema
   bloqueia (`restrict` em `db/schema.ts:265/297/450/647`) e não havia procedimento.
   → ADR 0046 decide e dá o runbook manual (vale já) + spec da feature.
2. **Base legal errada.** A política dizia que o tratamento se apoia "no seu
   consentimento ao criar a conta" junto com execução do serviço. → Agora é base por
   finalidade: art. 7º, V e IX; consentimento reservado (ADR 0047).
3. **Canal de contato provavelmente mudo.** `contato@palpiteiro.live` é o remetente do
   Resend (`docs/ops/03-email-resend.md:4`); nada no repo configura **recebimento**. Se a
   caixa não recebe, o único canal do titular (art. 9º, IV (V); Res. CD/ANPD 2/2022 art. 11
   (V2)) não funciona. → ação do dono nº 1.
4. **Texto livre do usuário vai pra IA e fica logado.** A aposta livre manda o texto
   digitado pra Anthropic e grava em `ai_calls.input_payload` (`lib/ai/bet-parse/parse.ts:77`)
   — a política não dizia isso. → declarado (§2, §5) e redigido na exclusão (ADR 0046).
5. **Aceite implícito dos Termos** num checkbox que já existia. → clickwrap explícito no
   mesmo clique (ADR 0047), fecha a #433.

Depois deste branch: **conforme**, com dois riscos aceitos e documentados (nome do
controlador ainda não publicado; exclusão manual até a feature) e um item a confirmar pelo
dono (caixa de entrada).

## 2. Item por item

Estado = arquivo:linha **depois** deste branch, salvo indicação. Veredito: **OK** (já estava
certo) · **ajustado** (corrigido neste branch) · **ajustar** (pendente, com dono/follow-up)
· **risco aceito** · **N/A**.

### 2.1 Apostas (Lei 14.790/2023, Portaria SPA/MF 1.231/2024, CONAR)

| # | Requisito | Norma | Estado | Veredito | Decisão |
|---|---|---|---|---|---|
| A1 | Não operar aposta nem se apresentar como casa | Lei 14.790 art. 2º (V) | `app/termos/page.tsx:54` (§1), footer `components/site-footer.tsx:71` | OK | ADR 0048 D1: ferramenta de análise, não operador nem afiliado |
| A2 | Não fazer publicidade de operador não autorizado | Lei 14.790 art. 40, III (V) | Nenhum link/banner/cupom de casa em `app/`, `components/` | OK | ADR 0048 D2: vedação dura em toda superfície |
| A3 | Não virar afiliado (remuneração de operador) | Portaria 1.231, def. de afiliado, art. 21 (V2) | Sem monetização, sem comissão | OK | ADR 0048 D2 + gatilhos D6 |
| A4 | Nome de casa como fonte da cotação (fonte `eu` inclui casas sem autorização no BR) | Lei 14.790 art. 40, III (V) | `components/odds-card.tsx:113`, `components/analysis-result.tsx:140`, `components/dashboard/prediction-detail.tsx:94`; fonte `lib/providers/odds-api.ts:32` | risco aceito | ADR 0048 D3: é atribuição de dado, sem link, só em área logada; nunca em superfície pública; Termos §5 (`app/termos/page.tsx:115`) explica |
| A5 | Sem promessa de ganho, aposta ≠ renda/investimento | Lei 14.790 art. 17, II-IV (V — vincula só operador; adotado voluntariamente); CDC art. 37 (NV) | Landing `app/landing-content.tsx:57`, Termos §4 (`:105`), footer `:34` | OK | ADR 0048 D4 |
| A6 | 18+ visível e autodeclaração | Lei 14.790 arts. 16 p.ú., 26, I (V); ECA (NV) | Footer `:32`, `/signin` `app/signin/sign-in-methods.tsx:65`, Termos §6 (`:126`) | OK | ADR 0048 D5: autodeclaração basta (não operamos aposta; minimização) |
| A7 | Avisos de risco nas superfícies de intenção de aposta | Lei 14.790 art. 16 p.ú. (V, voluntário) | `lib/view/analysis.ts:44` (#463), `components/free-bet.tsx:32`, `components/grade-my-bet.tsx:18`, `app/apostas/page.tsx:32`, `lib/view/share/disclaimer.ts:12` | OK | — |
| A8 | Canais de ajuda | prudência (CONAR Anexo X (NV)) | CVV 188 + Jogadores Anônimos no footer, Termos §9, `/p` | OK | — |
| A9 | Orientar a apostar só em casa autorizada; autoexclusão | prudência | Termos §1 (`.bet.br`) e §9 (autoexclusão) | ajustado | — |
| A10 | Público `/p/[id]` sem odds/valor e com disclaimers | ADR 0035; Lei 14.790 art. 17 (V, voluntário) | `components/palpites/public-palpite.tsx:100-120` | OK | — |

### 2.2 LGPD (Lei 13.709/2018) e ANPD

| # | Requisito | Norma | Estado | Veredito | Decisão |
|---|---|---|---|---|---|
| L1 | Identificação do controlador | art. 9º, III (V) | `lib/legal/controller.ts:13` (`CONTROLLER_LEGAL_NAME = null`), `/privacidade` §1 (`app/privacidade/page.tsx:67`), Termos §2 | ajustar (dono) | Slot único; hoje "pessoa física que mantém o projeto" + identificação sob pedido = conformidade parcial. Ação do dono nº 2 |
| L2 | Contato do controlador / canal sem encarregado | art. 9º, IV (V); Res. CD/ANPD 2/2022 art. 11 (V2) | `LEGAL_CONTACT_EMAIL` em `lib/legal/controller.ts:19`; footer "Contato" `:50`; `/privacidade` §1/§13; `/perfil` "Seus dados" (`app/perfil/page.tsx:91`) | ajustado + **ajustar (dono)** | Canal a 1 clique de toda página. Recebimento do e-mail não verificável daqui → ação do dono nº 1 |
| L3 | Finalidade, forma e duração | art. 9º, I-II (V) | `/privacidade` §3 (`:116`), §8 (`:199`) | ajustado | Retenção concreta: conta = enquanto existir; contadores ≤ 24h; logs = prazo do fornecedor |
| L4 | Base legal correta | art. 7º, V e IX (NV no texto do art. 7º); art. 10 (NV) | `/privacidade` §3 | ajustado | ADR 0047 D3: contrato pro serviço, legítimo interesse pra segurança/custo/prova; **não** consentimento |
| L5 | Minimização | art. 6º, III (NV) | `/privacidade` §2 (`:88`) | OK | Sem CPF/telefone/documento/dado sensível |
| L6 | Compartilhamento e operadores | art. 9º, V; art. 18, VII (V) | `/privacidade` §5 (`:152`) | ajustado | Acrescentados Google (login) e o texto livre que vai pra Anthropic/OpenAI |
| L7 | Direitos do art. 18 com menção explícita | art. 9º, VII; art. 18, I-IX e § 1º (V) | `/privacidade` §9 (`:228`) | ajustado | Lista completa + oposição + petição à ANPD |
| L8 | Prazo de resposta | art. 19, II (V); Res. 2/2022 art. 14 (V2) | `DATA_REQUEST_RESPONSE_DAYS = 15` (`lib/legal/controller.ts:24`), `/privacidade` §8-§9, `/perfil` | ajustado | 15 dias pra tudo; não usamos o prazo em dobro |
| L9 | Eliminação ao fim do tratamento | arts. 15, III; 16; 18, VI (V) | Schema bloqueia delete (`db/schema.ts:265/297/450/647`); `/privacidade` §8 descreve o que acontece | ajustar (follow-up) | ADR 0046: tombstone + apagar PII + anonimizar histórico; **runbook SQL manual vale já**; feature self-serve especificada |
| L10 | Anonimização do que fica | arts. 12 e 16, IV (V) | ADR 0046 D4 | risco aceito | Uso só agregado, sem drill-down de conta excluída, sem acesso de terceiro; risco residual (memória do dono em escala de amigos) aceito |
| L11 | Texto livre do usuário (aposta livre) enviado à IA e logado | art. 6º, III (NV); art. 9º, V (V) | `lib/ai/bet-parse/parse.ts:77`, `cartridge.ts:99`; `/privacidade` §2/§5; Termos §8 | ajustado | Declarado + orientação a não digitar dados pessoais; redigido na exclusão (ADR 0046 D1 #1) |
| L12 | Transferência internacional | art. 33, IX (V) | `/privacidade` §6 (`:180`) | ajustado + risco aceito | Art. 33, IX c/c art. 7º, V pro serviço; tratamentos de legítimo interesse (Sentry/Upstash) apoiados nas garantias contratuais dos fornecedores — risco aceito (Res. CD/ANPD 19/2024 (NV)) |
| L13 | Encarregado | art. 41, § 3º (V); Res. 2/2022 arts. 2º, I; 3º; 4º; 11 (V2) | `/privacidade` §13 (`:298`) | OK | ADR 0047 D8: pessoa natural = pequeno porte; sem alto risco (falta critério geral) → dispensado, com canal |
| L14 | Dados de menores | art. 14 (V); ECA (NV) | `/privacidade` §11, Termos §6 | ajustado | Não destinado a menores; conta de menor é excluída |
| L15 | Cookies | LGPD (princípios); guia da ANPD (NV) | `/privacidade` §7; cookies reais: sessão Auth.js, `tz` (`components/timezone-sync.tsx:39`), tema em localStorage | ajustado | Só essenciais → sem banner de cookies |
| L16 | Decisões automatizadas | art. 20 (V) | `/privacidade` §4 | N/A (declarado) | A IA analisa partidas, não pessoas |
| L17 | Segurança e incidentes | arts. 46 e 48 (NV) | `/privacidade` §12; Sentry `sendDefaultPii: false` (`sentry.server.config.ts`, `instrumentation-client.ts`) | OK | — |
| L18 | Compartilhamento público opt-in | art. 7º, V (NV) | `/p` sem nome/e-mail/foto (`components/palpites/public-palpite.tsx`); `/privacidade` §10 | OK | Botão "Parar de compartilhar" (kill-switch do #499, `components/palpites/palpite-hero.tsx:357`); §10 aponta pra ele |
| L19 | Portabilidade | art. 18, V (V) | Por e-mail, manual | risco aceito | Export JSON manual sob pedido até existir demanda |
| L20 | Prova do aceite de contas antigas | — | `accepted_terms_at` só no `createUser` (`auth.ts`) | risco aceito | ADR 0047 D6: carimbar no `signIn` quando nulo (follow-up S) |

### 2.3 Contrato, consumo e internet (CDC, Marco Civil, Decreto 7.962)

| # | Requisito | Norma | Estado | Veredito | Decisão |
|---|---|---|---|---|---|
| C1 | Aceite dos Termos | contrato de adesão; CC arts. 107/425 (NV) | `app/signin/sign-in-methods.tsx:65` | ajustado | Clickwrap no checkbox do 18+ (ADR 0047 D1) |
| C2 | Limitação de responsabilidade válida | CDC arts. 3º § 2º, 25, 51, I (NV) | Termos §10 (`app/termos/page.tsx:183`) | ajustado | Serviço gratuito sem remuneração indireta → hoje não há relação de consumo; cláusula ganhou "na medida permitida pela lei" + ressalva de direitos irrenunciáveis, pra não cair inteira se virar consumo |
| C3 | Foro e lei aplicável | CDC art. 101, I (NV) | Termos §13 (`:217`) | ajustado | Lei brasileira, foro do domicílio do usuário |
| C4 | Alterações dos Termos | boa-fé; CDC art. 51 (NV) | Termos §12 (`:207`) | ajustado | Mudança que reduza direitos → novo aceite (ADR 0047 D5) |
| C5 | Identificação do fornecedor no comércio eletrônico | Decreto 7.962/2013 art. 2º (NV) | — | N/A | Só com cobrança; gatilho no ADR 0048 D6 |
| C6 | Guarda de registros de acesso por 6 meses | Marco Civil art. 15; art. 5º, VIII (V) | Sem access log próprio | N/A | Só pra PJ com fins econômicos; gatilho no ADR 0048 D6 |
| C7 | Páginas legais acessíveis sem login | — | `middleware.ts:54` (`termos$`, `privacidade$`) | OK | — |

## 3. Ações que só o dono pode executar

| # | Ação | Recomendação |
|---|---|---|
| 1 | **Confirmar que `contato@palpiteiro.live` recebe e-mail** (roteamento inbound: Cloudflare Email Routing, ImprovMX ou alias de um provedor de e-mail) e mandar um teste de fora | **Fazer já — prioridade máxima.** É o único canal do titular (LGPD art. 9º, IV; Res. 2/2022 art. 11). Se preferir outro endereço (ex.: `privacidade@`), trocar só `LEGAL_CONTACT_EMAIL` em `lib/legal/controller.ts` |
| 2 | **Publicar o nome civil como controlador** (`CONTROLLER_LEGAL_NAME` em `lib/legal/controller.ts:13`, e bump da data nas duas páginas) | **Publicar — só o nome completo**, sem CPF nem endereço. É o que falta pro art. 9º, III ficar integral, e a exposição é mínima (nome, sem documento). Até lá, o texto atual (identificação sob pedido) é risco aceito |
| 3 | **MEI/CNPJ** | **Não agora.** Só quando decidir cobrar qualquer coisa (ADR 0048 D6). Doação voluntária pode ser recebida como pessoa física. Constituir PJ sem receita traz custo fixo e dispara obrigações (Marco Civil art. 15) sem benefício |
| 4 | **INPI** | **Busca de anterioridade agora** (gratuita) por "palpiteiro" nas classes 41, 42 e 9 (Report 08). **Depósito só junto com o MEI**, como marca mista (logo + "palpiteiro.live"), nas classes 41 e 42 — pessoa física só pode registrar marca da atividade que exerce de modo efetivo e lícito (Lei 9.279/1996 art. 128, § 1º (NV)), o que o MEI resolve |
| 5 | **Executar pedidos de exclusão** até a feature existir | Rodar o runbook SQL do ADR 0046 no Neon de produção, em até 15 dias, só pra pedido vindo do e-mail da conta |
| 6 | **DPAs dos fornecedores** (Vercel, Neon, Resend, Anthropic, Upstash, Sentry, Google Cloud do OAuth) | Conferir nos painéis que o DPA de cada um está vigente (na maioria já vem embutido nos termos; alguns pedem aceite). Baixa prioridade; sustenta L12 |

## 4. Issues

- **#431** (páginas `/termos` + `/privacidade` + middleware): **atendida pelo que está no ar**
  desde o #461 — rotas estáticas, `termos$|privacidade$` no matcher (`middleware.ts:54`),
  testes de contrato (`components/__tests__/legal-pages.test.tsx`). **Pode fechar.**
- **#432** (footer global): **atendida em substância pelo #461** — selo 18+, jogo
  responsável, CVV 188, Jogadores Anônimos, Termos/Privacidade, não-operador, em toda rota
  menos `/p` (que tem os próprios disclaimers). Diferenças do texto da issue, sem impacto
  legal: é Client Component (usa `usePathname` pra se ocultar em `/p`), o `body` não virou
  `flex`/`mt-auto`, e a linha inline da landing ficou (redundância inofensiva). **Pode fechar.**
- **#433** (consentimento Termos + Privacidade no `/signin`): **não atendida pelo que está no
  ar** (o #461 escolheu o implícito). **Atendida por este branch** (ADR 0047: clickwrap dos
  Termos; a Política é informada, não "aceita" — de propósito). Fechar no merge.
- **Follow-ups a abrir** (sugestão): (a) exclusão de conta self-serve — spec no ADR 0046 D5;
  (b) carimbo de `accepted_terms_at` no `signIn` quando nulo — ADR 0047 D6. (O botão de
  "parar de compartilhar" — L18 — já chegou com o #499.)
- **#438** (re-auditar `/p`): do lado de privacidade, conferido — o público não expõe dado
  pessoal (L18); a re-auditoria de segurança segue em aberto.

## 5. Citações

**Conferidas na fonte primária (planalto.gov.br) nesta sessão:** LGPD arts. 9º (I-VII),
12 (caput e § 1º), 14, 15, 16 (I-IV), 18 (I-IX, § 1º), 19 (II), 20, 33 (IX), 41 (§ 3º);
Lei 14.790/2023 arts. 2º (definições), 16, 17 (caput, incisos, §§ 1º-6º), 26 (I), 40 (III);
Marco Civil arts. 5º (VIII) e 15.

**Conferidas só em fonte secundária:** Res. CD/ANPD nº 2/2022 arts. 2º (I), 3º, 4º, 11, 14
(normaslegais.com.br); Portaria SPA/MF nº 1.231/2024 — escopo (operadores e afiliados),
definição de afiliado, arts. 12, 13, 21 (artigo do escritório Baptista Luz).

**Não verificadas — conferir depois:** LGPD arts. 5º (XII), 6º (III, X), 7º (texto dos
incisos I, V, VI, IX), 8º (§§ 4º, 5º), 9º (§ 3º), 10, 13, 18 (§ 2º), 46, 48; Res. CD/ANPD
nº 19/2024 (cláusulas-padrão de transferência); guia de cookies da ANPD; CDC arts. 3º
(§ 2º), 25, 37, 49, 51 (I), 101 (I); Código Civil arts. 107, 425; Decreto 7.962/2013 art.
2º; Lei 9.279/1996 art. 128 (§ 1º); ECA; CONAR Anexo X; RFC 2606.

## 6. O que mudou neste branch

- `app/privacidade/page.tsx` — reescrita (15 seções), data 24/09/2026.
- `app/termos/page.tsx` — reescrita (14 seções), data 24/09/2026.
- `app/signin/sign-in-methods.tsx` — clickwrap dos Termos.
- `components/site-footer.tsx` — link "Contato".
- `app/perfil/page.tsx` — seção "Seus dados" (caminho pros direitos do art. 18).
- `lib/legal/controller.ts` — fonte única de controlador, contato e prazo.
- `db/schema.ts` — só comentário do `accepted_terms_at` (sem migration).
- Testes: `components/__tests__/legal-pages.test.tsx`, `app/signin/__tests__/sign-in-methods.test.tsx`.
- ADRs 0046, 0047, 0048.
