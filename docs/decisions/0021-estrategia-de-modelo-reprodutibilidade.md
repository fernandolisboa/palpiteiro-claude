# ADR 0021 — Estratégia de modelo da análise: reprodutibilidade vs capacidade

## Status

Accepted (2026-06-12) — **emenda o ADR 0008** (default global Opus 4.8 → Sonnet 4.5)

> **Nota (2026-06-14):** O **Fable 5 foi removido do registry** (issues #240/#241)
> por custo + indisponibilidade no Brasil; o Opus 4.8 cobre os overrides admin de
> capacidade alta. O **Sonnet 4.5 foi promovido a `userSelectable: true`** (#240),
> então **deixa de ser admin-only** — não sobra nenhum modelo admin-only. As
> referências ao Fable e à condição admin-only do Sonnet 4.5 abaixo são de
> 2026-06-12; a estratégia de reprodutibilidade (default temperature-mode + override
> de capacidade) permanece, apenas sem o Fable na coluna de overrides.

> **Nota (2026-06-19, #374):** A opção de **override de capacidade adaptive** (Opus
> 4.8, citada aqui na coluna de overrides) **não existe mais no registry** — Opus 4.8
> e Sonnet 4.6 (os dois modelos `adaptive`) foram removidos, junto com o gpt-5-mini de
> prova. O registry foi estreitado aos **dois modelos `temperature`/reproduzíveis**
> (Sonnet 4.5 + Haiku 4.5). O **default permanece o Sonnet 4.5** (sem migration — a row
> `ai_config` já estava seedada nele desde a migration 0032). O ramo `adaptive` do
> request-builder segue **vivo no código mas inalcançável** por qualquer modelo de
> registry (preservado para um futuro modelo adaptive sem ressuscitar código).

## Contexto

O default global da análise é o **Opus 4.8** (`DEFAULT_MODEL_ID` em `lib/ai/models.ts`),
que usa _adaptive thinking_ e **não permite fixar temperatura** — Opus 4.x rejeita
`temperature`/`top_p`/`top_k` com **HTTP 400** (ver `lib/ai/request-builder.ts` e
ADR 0008, decisão 4). Resultado: a análise default é a **menos reproduzível** do
registry, e ainda a mais cara entre os modelos de uso comum ($5/$25 por MTok).

A recomendação é um **corte duro** (edge ≥ 5pp sobre a implícita normalizada) sobre uma
estimativa **contínua** de confiança. Jogos cuja confiança real caia em ~±5pp do corte
**oscilam** (`pass` ↔ `over`/`under`) com qualquer ruído de amostragem. Nos caminhos
_adaptive_ (Fable 5, Opus 4.8, Sonnet 4.6) não há como atenuar esse ruído via
temperatura; nos caminhos _temperature_ (Sonnet 4.5, Haiku 4.5, fixos em `0.3`) a saída
é praticamente estável.

Evidência concreta do gate de replay eval do #105:

- Os 2 payloads **Sonnet 4.5** (`temperature: 0.3`) reproduziram a baseline **idêntica**
  (Δconfidence 0.0pp, zero flip) em 3 execuções manuais do gate.
- O único flip do gate foi num payload **Opus 4.8** _borderline_. Um teste **A/A**
  (replay do mesmo payload com o system prompt **inalterado**) flipou `pass→over`
  sozinho — ou seja, é **ruído de amostragem do caminho adaptive**, pré-existente, não
  efeito de mudança de prompt.

> Nota de escopo: cada análise é gerada **uma vez e persistida** (ADR 0010 — visão
> admin cross-user); usuários diferentes que analisam o mesmo jogo criam predições
> separadas. Reprodutibilidade **não** serve pra "todos verem a mesma leitura"; serve pra
> (1) o usuário não receber uma recomendação borderline quase cara-ou-coroa sem saber, e
> (2) o gate de eval do #105 não reprovar por ruído.

Registry atual (`lib/ai/models.ts`):

| Modelo                 | thinkingMode | temperatura | userSelectable | in/out (USD/MTok) |
| ---------------------- | ------------ | ----------- | -------------- | ----------------- |
| Fable 5                | adaptive     | ❌          | admin-only     | 10 / 50           |
| **Opus 4.8 (default)** | adaptive     | ❌          | sim            | 5 / 25            |
| Sonnet 4.6             | adaptive     | ❌          | sim            | 3 / 15            |
| Sonnet 4.5             | temperature  | ✅ 0.3      | admin-only     | 3 / 15            |
| Haiku 4.5              | temperature  | ✅ 0.3      | sim            | 1 / 5             |

## Decisão

1. **Sonnet 4.5 vira o default da análise** (Via A). `DEFAULT_MODEL_ID` passa pra
   `claude-sonnet-4-5-20250929`, emendando o ADR 0008 (que fixou Opus 4.8). Como o
   default global vale pra **todos** os usuários, e o ADR 0013 invariante "o default tem
   que ser `userSelectable`", **Sonnet 4.5 passa a `userSelectable: true`**. Opus 4.8,
   Fable 5 e Sonnet 4.6 continuam como **override** (por análise e/ou preferência de
   usuário, audience-gated) pra quem quiser puxar um modelo mais forte num jogo
   específico. Com isso, **só o Fable 5 permanece admin-only** (`userSelectable: false`).

2. **Gate de eval do #105 vira _model-aware_** (Via C). Hoje o gate reprova se
   `flips.length > 0 || medianΔconf > 5pp || errors.length > 0`, sem distinguir o
   caminho. A mudança escopa **só a regra de flip**: um flip de `recommendation` num
   payload de caminho **adaptive** (Opus/Fable/Sonnet 4.6 — instáveis por construção,
   sem knob de amostragem; no #105 só o caminho **Opus** foi observado flipando) só
   conta como **reprovação** se **reproduzido em N runs** (mata o ruído single-shot); no
   caminho **temperature** (Sonnet 4.5/Haiku) mantém-se o critério estrito ("qualquer
   flip = reprovado"), porque ali a saída é estável. Os outros abortos do gate (mediana
   de |Δconfidence| > 5pp e `errors.length > 0`) **ficam intocados**. Assim o gate fica
   honesto sobre a variância de cada caminho e segue robusto contra um override Opus.

3. **Invariantes do ADR 0013 preservados.** A audiência continua sendo só a flag
   `userSelectable` + os helpers `modelsForAudience`/`isModelAllowedForAudience`; a
   cascade de resolução de 4 níveis (`override por análise > preferência do usuário >
default global > DEFAULT_MODEL_ID`) com gate de audiência por nível e
   `DEFAULT_MODEL_ID` como fallback terminal segue intacta. Mover Sonnet 4.5 pra
   `userSelectable: true` é edição **registry-only** (sem migration).

4. **Implementação fica pra follow-up.** Este ADR registra a **decisão**; mudar
   `DEFAULT_MODEL_ID`, flipar o `userSelectable`, atualizar o seed/row de `ai_config`
   (o default global persistido, editável em `/admin/settings`) e tornar o gate
   model-aware ficam pra issue(s) de follow-up após aceitação deste ADR.

## Razão

- **Reprodutibilidade**: `temperature: 0.3` + `tool_choice` forçado → saída estável
  (evidência #105: Δconf 0.0pp, zero flip em 3 execuções). O caminho adaptive não tem
  knob pra atenuar ruído.
- **Custo**: Sonnet 4.5 a **$3/$15** vs Opus a **$5/$25** — ~40% mais barato em input e
  output. Cada análise custa dinheiro real (gotcha do CLAUDE.md), e o default roda em
  toda análise de usuário comum.
- **Gate limpo**: o caminho temperature força o `submit_prediction` (sem risco de
  `tool_missing` do caminho `auto`/adaptive), então o gate do #105 passa sem flakiness
  estrutural.
- **Capacidade ainda acessível**: Sonnet 4.5 está abaixo de Opus/Fable na ordem do
  registry, mas a tarefa é **estruturada** (output forçado por tool, cálculo de edge
  explícito sobre a implícita normalizada). A perda marginal de capacidade no default é
  compensada por reprodutibilidade + custo + estabilidade do gate; quem quiser mais
  capacidade num jogo específico usa o **override**.
- **A + C combinam**: Sonnet default estável + gate robusto pra quando rodar contra um
  override adaptive (Opus). As vias não são exclusivas.

## Alternativas consideradas

- **Manter Opus 4.8 como default (status quo)**: rejeitado — é a análise menos
  reproduzível e a mais cara entre os modelos de uso comum; é a raiz do ruído de
  thresholding observado no #105.
- **Via A isolada (Sonnet default, gate inalterado)**: rejeitado — o gate estrito
  single-shot continuaria instável quando rodado contra payloads adaptive (override
  Opus), reprovando bumps de prompt por ruído de amostragem, não por regressão real.
- **Via B (prompt mais restritivo) como solução principal**: rejeitado — forçar o
  modelo a explicitar o cálculo e exigir margem maior **encolhe** a zona cinzenta mas
  **não elimina** a instabilidade de thresholding (corte duro sobre sinal contínuo
  permanece); muda a distribuição → exige bump de prompt + novo eval; e consome do
  `MAX_TOKENS`. Pode ser complementar no futuro, mas não ataca a raiz (reprodutibilidade
  do caminho default).
- **Via C isolada (manter Opus, só gate model-aware)**: rejeitado como solução principal
  — melhora a confiabilidade do **gate**, mas não melhora a reprodutibilidade do
  **produto**: o usuário continua recebendo recomendações borderline quase cara-ou-coroa.
- **Sonnet 4.5 default mas mantido admin-only (`userSelectable: false`)**: rejeitado —
  viola o invariante do ADR 0013 (o default vale pra todos, então tem que passar o gate
  de audiência como `userSelectable`).

## Consequências

- (+) Análise default reproduzível (`temperature 0.3`, tool forçado) e ~40% mais barata
  que o Opus.
- (+) Gate de eval do #105 confiável: estrito no caminho estável (temperature),
  tolerante a ruído de amostragem no adaptive (N runs).
- (+) Capacidade alta continua acessível via override (Opus/Fable/Sonnet 4.6), sem
  migration.
- (−) **Emenda a postura do ADR 0008** (Opus default). Supersede também o framing "dois
  modelos: Opus + Sonnet 4.5" das decisões 3/4 do ADR 0008 — já desatualizado pelo
  ADR 0013, que adicionou Fable 5 e Haiku 4.5 e a flag `userSelectable`.
- (−) Sonnet 4.5 passa a aparecer no dropdown do usuário comum (mudança de audiência);
  é edição registry-only, sem migration.
- (−) Capacidade do default cai em relação ao Opus (mitigada pelo override por jogo).
- (±) O knob `temperature` de `ai_config` (ADR 0008, Emenda 2), antes inócuo no default
  adaptive (Opus ignora amostragem), passa a reger **toda análise default** — calibrá-lo
  agora tem efeito global, não só nos overrides de caminho temperature.
- (−) A decisão exige um **follow-up de implementação** (DEFAULT_MODEL_ID, flag de
  audiência, seed/row de `ai_config`, gate model-aware) — este ADR só registra a direção.

## Referências

- Discovery e decisão pedidos no **#123**; evidência do gate em **#105** (replay eval,
  incl. o teste A/A) — PR já mergeado.
- **Emenda o ADR 0008** (modelo configurável, default Opus 4.8) e **preserva o
  ADR 0013** (seleção de modelo pelo usuário + gating por audiência).
- Código: `lib/ai/models.ts` (`DEFAULT_MODEL_ID`, `userSelectable`),
  `lib/ai/request-builder.ts` (split adaptive vs temperature),
  `scripts/replay-prompt-eval.ts` (gate a tornar model-aware).
- Implementação: issue(s) de follow-up (não inclusas neste ADR).
