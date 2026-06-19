# ADR 0031 — Palpite embasado: a manchete vira a melhor previsão usando o máximo de informação (value-aware)

## Status

Accepted (2026-06-19) — **emenda o ADR 0030**. O 0030 cravou o palpite-first (manchete = HERO, análises = detalhe) e levantou a firewall de **dado** (a síntese PODE consumir as análises/edge). Esta ADR vai um passo além no **conteúdo da decisão**: o palpite deixa de ser obrigado a prever só o favorito óbvio e passa a ser **value-aware** — a melhor previsão do resultado usando o **máximo de informação disponível** (dados + análises/EV + notícias). **Preserva integralmente** a firewall de **linguagem de valor na manchete** (`lib/ai/palpites/value-language-guard.ts`), o badge **liquidável** (acertou/errou, incluindo os tipos derivados de gols do #354) e os números de valor **explícitos na camada de Análise** (`components/analysis-result.tsx`). Consome notícias como insumo via o provider novo da **ADR 0032**. **Respeita a fronteira `lib/ai/predict.ts` do ADR 0027** (síntese é um `predict()`, logado em `ai_calls`).

> **Escopo:** produto + IA. A implementação aterrissa em issues separadas: #376 (mudança da síntese), #379/#380 (confiabilidade), #378 (disclaimer/UI). Onde houver tensão entre "palpite mais interessante/útil" e "exposição regulatória", a resolução é **sempre** manter número e linguagem de valor fora da manchete + disclaimer explícito.

## Contexto

O ADR 0030 fez o palpite-first e abriu o dado pra síntese, mas a regra de **comportamento** da manchete ficou amarrada num dogma herdado: o cartucho de síntese **proíbe** o palpite de levar valor em conta e **obriga** prever sempre o favorito óbvio. A regra está viva em prod (`lib/ai/palpites/cartridges/cartridge.ts:162`, dentro do `SYSTEM_PROMPT` `:147`, versão `PALPITES_VERSION = "palpites_v4"` `:26`):

> "Mesmo que NENHUM mercado tenha valor (todas as análises deem 'pass'/sem recomendação), DÊ MESMO ASSIM seu palpite honesto de quem ganha + placar provável, derivado da forma, do histórico e da tabela. Nunca recuse o palpite por falta de valor."

O efeito colateral é um palpite **chato**: ele ignora deliberadamente o sinal de edge/EV que o motor **já computa** e **já entrega** à síntese. O app tem na mão o resultado de um fan-out multi-mercado ranqueado por edge/EV (`runFanOut` → `toBestBetView`, ADR 0030), mas a manchete é instruída a fingir que esse sinal não existe. Um palpite que um amigo entendido dá NÃO é "o favorito ganha" no automático — é uma leitura **informada**, que às vezes crava o azarão quando o quadro completo justifica.

Ao mesmo tempo, a proteção que importa de verdade **já está implementada e é preservada**: a manchete nunca pode carregar **número nem linguagem de valor**. Isso é garantido pós-Zod por `lib/ai/palpites/value-language-guard.ts` (`containsValueLanguage`, `:30`), que barra `edge/ev/valor esperado/stake/unidades/yield/lucro/retorno/profit/odd/cotação/R$` em `verdict`/`narrative` — um hit é tratado como `invalid_output` → degrada pro palpite nulo (REJEITAR > VAZAR). A regra inviolável correspondente no próprio prompt está em `cartridge.ts:161`. Os números de valor vivem **só na Análise** (`components/analysis-result.tsx:120-159`: stake, odd na análise, EV), a camada sóbria onde são legítimos.

A postura regulatória — "ferramenta informativa/educacional, não operador de apostas", **não prometer retorno** — está fundada na Lei 14.790/2023 e documentada em `docs/ops/05-legal-compliance.md §1` ("o Palpiteiro NÃO é casa de aposta"; `:37-67`) e §6 (contexto regulatório, `:192`). O mesmo cuidado que rejeitou o domínio `.bet` (risco regulatório). Essa postura **não depende** de o palpite prever o óbvio; depende de (a) número/linguagem de valor fora da manchete e (b) o enquadramento "é só um palpite". O §3 do mesmo doc ("Jogo responsável + aviso de risco", `:93`) já prescreve um aviso de risco perto da recomendação (`:118`).

Conclusão: dá pra tornar o palpite **value-aware** (mais interessante, mais útil) **sem** cruzar pra "recomendação de aposta com retorno prometido", desde que se mantenha o trio inviolável — firewall de linguagem de valor, badge liquidável, valor explícito só na Análise — e se adicione um **disclaimer** explícito.

## Decisão

**1. A manchete é a melhor PREVISÃO DO RESULTADO, agora gerada com o MÁXIMO de informação.** A síntese passa a usar tudo o que o app tem: dados de partida (forma/H2H/tabela), as análises multi-mercado **com seu edge/EV**, e **notícias** (novo, via ADR 0032). A manchete é **value-aware**: pode cravar um **lado não-óbvio** quando o quadro completo justifica. Um palpite que só repete o favorito é desinteressante e desperdiça sinal que o app já calcula.

**2. Continua sendo uma previsão LIQUIDÁVEL e FALÍVEL.** O `probableScore` segue coerente com o veredito; o badge acertou/errou (incluindo os tipos derivados de gols do #354) é **inalterado**. A manchete **NÃO** é reposicionada como recomendação de aposta — segue um "palpite" honesto e falível. O badge **vai** dizer "errou" às vezes — tudo bem: é palpite, não garantia.

**3. O que muda vs 0030.** Cai o dogma do `cartridge.ts:162` que obriga ignorar valor e prever sempre o favorito óbvio ("Mesmo que NENHUM mercado tenha valor… DÊ MESMO ASSIM… Nunca recuse o palpite por falta de valor"). Valor/EV deixa de ser algo a **ignorar** e vira **insumo legítimo da previsão**. Mudança de prompt → **bump de versão** do cartucho (`PALPITES_VERSION`, `cartridge.ts:26`), registrada em commit `prompt:` (CLAUDE.md, ADR 0017).

**4. O que é PRESERVADO (inviolável):**
   - **(a)** A **firewall de linguagem de valor na manchete** — `lib/ai/palpites/value-language-guard.ts` (`containsValueLanguage`, `:30`) **FICA**. Número e linguagem de valor (edge/EV/stake/odd/retorno/lucro/yield/cotação/R$) **nunca** cruzam pra `verdict`/`narrative`. A regra correspondente no prompt (`cartridge.ts:161`) **fica**.
   - **(b)** O **badge liquidável** (placar provável conferido depois; tipos do #354).
   - **(c)** EV/edge/stake seguem **explícitos na camada de Análise** (`components/analysis-result.tsx:120-159`) — a camada informativa sóbria onde números de valor são legítimos.

**5. Novo: um disclaimer/rótulo na manchete.** Adiciona-se ao palpite, na cara do usuário, um aviso "é só um palpite, não é recomendação de aposta". É exatamente a mitigação que a postura legal já prescreve (`docs/ops/05-legal-compliance.md §3` jogo-responsável/aviso-de-risco; §5 termos "ferramenta informativa/educacional, não casa de apostas"). Um palpite value-aware **+** disclaimer **+** linguagem de valor fora da manchete **não** cruza pra "operador de apostas / promete retorno" (Lei 14.790, `§1`/`§6` — a mesma postura que rejeitou o domínio `.bet`).

**6. Fronteira `predict.ts` (ADR 0027) intacta.** A síntese segue **um** `predict()` por run, logado em `ai_calls`. Os novos insumos (notícias da ADR 0032) entram pela mesma porta.

## Consequências

- **(+)** O palpite finalmente **usa o sinal de valor que o motor já computa** — menos óbvio, mais útil, mais parecido com a leitura informada de um amigo que entende do jogo. Engajamento (o objetivo do arco) sobe.
- **(+)** Zero firewall nova removida: o trio inviolável (linguagem de valor fora da manchete, badge liquidável, valor só na Análise) **continua de pé**. A mudança é de **comportamento da previsão**, não de proteção.
- **(+)** O disclaimer torna a postura regulatória **explícita na UI**, em vez de implícita — fecha a brecha de "parece dica de aposta".
- **(−)** A mudança do prompt de síntese é uma alteração **em prod** (bump de versão; o cartucho roda LIVE). Exige cuidado de rollout/observação.
- **(−)** Vereditos value-aware vão **errar mais** às vezes do que "só o favorito" erraria (apostar/prever um lado menos provável quando o EV justifica perde mais no curto prazo). **Aceito**: é palpite + disclaimer + badge honesto, não uma promessa.
- **(−)** Exige um teste/guard de regressão garantindo que a firewall de linguagem de valor continua barrando o conteúdo mesmo com o prompt agora autorizado a **raciocinar** sobre valor (o LLM tem mais chance de escorregar um termo de valor no texto — o guard pós-Zod cobre isso, mas o caso fica mais quente).

## Alternativas consideradas

1. **Mostrar EV/lucro/stake na manchete** ("Aposte X, lucro esperado Y") — **rejeitado**: cruza pra "recomendação com retorno prometido" (Lei 14.790, `docs/ops/05-legal-compliance.md §1`/`§6`), o mesmo risco que rejeitou `.bet`. O valor vive na **Análise** + numa ponte narrativa, **nunca** como número na manchete (firewall `value-language-guard.ts` permanece).
2. **Manter o palpite ignorando valor / só o óbvio** (o dogma do 0030, `cartridge.ts:162`) — **rejeitado**: produz um palpite chato, que ignora sinal que o app já calcula. O palpite informado de um amigo É value-aware.
3. **Repositionar o palpite como aposta de valor pura** (bancar o azarão por −prob/+EV) — **rejeitado**: quebra o badge liquidável (apostas de valor perdem na maioria dos eventos individuais) e vira dica de aposta. O palpite continua uma **previsão falível**, só que value-aware — não uma estratégia de staking.

## Referências

`lib/ai/palpites/cartridges/cartridge.ts:147` (`SYSTEM_PROMPT`), `:161` (regra inviolável — linguagem de valor fora da manchete, **preservada**), `:162` (dogma "ignore valor, preveja o favorito" — **removido** por esta decisão), `:26` (`PALPITES_VERSION = "palpites_v4"` — alvo do bump), `:173-176` (`SUBMIT_PALPITE_TOOL`, ToolDef neutro sem campo de valor, ADR 0027); `lib/ai/palpites/value-language-guard.ts:12-26` (`VALUE_LANGUAGE_PATTERNS`), `:30` (`containsValueLanguage`, guard pós-Zod, **preservado**); `components/analysis-result.tsx:120-159` (stake/odd/EV — conteúdo da Análise, **preservado**); `lib/ai/predict.ts` (única porta da LLM, ADR 0027 — síntese é `predict()` logado em `ai_calls`); `docs/ops/05-legal-compliance.md §1` `:37-67` (não-operador; Lei 14.790; não prometer retorno), `§3` `:93-118` (jogo responsável + aviso de risco perto da recomendação), `§5` `:170-188` (termos: ferramenta informativa/educacional), `§6` `:192` (contexto regulatório Lei 14.790/2023). ADR 0030 (**emendado**: além de levantar a firewall de dado, o palpite agora é value-aware + disclaimer; firewall de linguagem de valor + badge liquidável + valor na Análise preservados), ADR 0027 (`predict.ts` única porta), ADR 0017 (cartucho por mercado + versionamento; bump de versão no commit `prompt:`), ADR 0019 (staking — insumo da síntese, não exposto na manchete), ADR 0032 (provider de notícias — novo insumo do palpite embasado). Issues de implementação: #376 (síntese value-aware), #379/#380 (confiabilidade), #378 (disclaimer/UI). CLAUDE.md ("não furar `predict.ts`", "não pular Zod no output da LLM", commit `prompt:` pra mudança de versão de prompt).
