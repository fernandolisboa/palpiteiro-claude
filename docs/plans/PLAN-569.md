# PLAN-569 — Subtipos tipados para "outra informação"

Issue: #569 (follow-up de #564/#565, ADR 0055). Snapshot histórico, não spec viva.

## Problema

Uma afirmação `topic: "other"` ("o técnico foi demitido", "é clássico", "vai chover") sai
"não verificável, sem efeito" e, no contexto extra da análise com IA (#565), **não chega a
lugar nenhum**: o narrador `code_jev` só vê os fatores do JEV que se moveram, e o
"o que você acrescentou" mostra "outra informação sobre o X". No "Seu palpite" o narrador
já vê a paráfrase cercada, então lá o ganho é só de rótulo.

## Decisão

1. **Extração `user_palpite_extract_v2`** (mesmo prefixo `user_palpite`, coberto pela
   linha 1 da redação do ADR 0046). Campo opcional `otherKind` no item, enum
   `OTHER_KINDS = coach_change | derby | weather | travel_fatigue | crowd | motivation`,
   só válido com `topic: "other"` (superRefine). Sem subtipo que encaixe (retrospecto,
   arbitragem…) → omitido, comportamento de hoje. Prioridade no prompt: o que cabe em
   `stakes`/`rotation`/`form`/`absence` continua nesses tópicos (são os que movem fator);
   `travel_fatigue` é viagem/altitude/fuso, desgaste de calendário segue `rotation`;
   `motivation` é motivação fora da tabela (despedida, vingança, pressão da torcida
   sobre o elenco), "precisa vencer pra não cair" segue `stakes`.
   `normalizeClaimInput` tira `otherKind` vazio/nulo e `otherKind` fora de `other`
   (melhor perder o subtipo que a afirmação inteira).
2. **Sem efeito numérico.** `checkClaims` continua: `other` = não verificável, sem sinal.
   `evidence.ts`, gate, stake, odds, modelo intocados.
3. **Linha montada pelo código** (`lib/user-palpite/labels.ts`, puro):
   `otherKindLine(c, teams)` → "troca de técnico no Flamengo", "clássico entre os dois
   times", "clima ou gramado que pode pesar no jogo", "desgaste de viagem do X",
   "torcida como fator pro X", "motivação do X como fator". `derby`/`weather` ignoram o
   time. `contextNotes(claims, teams)` = linhas dedupe `"<linha>, informado por você, não
   conferido"` de toda afirmação `other` com `otherKind`.
   `claimDescription` usa a linha quando há `otherKind`; `claimTopicLabel(c)` dá o rótulo
   do subtipo ("troca de técnico", "clássico", …) nas duas telas.
4. **Narrador `narrator_v1.2`.** `NarratorDecision.userNotes?: string[]`;
   `applyUserClaims` devolve `notes`; `toNarratorDecision` passa. A mensagem ganha a seção
   "## Informado por você (não conferido, sem efeito nos números)" **só quando há nota**
   (sem nota a mensagem fica igual à v1.1). Regra 4 do prompt: pode citar como
   informação da pessoa, nunca como fato nem como motivo dos números. Live narrator e
   cartuchos LLM não mudam (contexto extra é só pré-jogo e só `code_jev`).
5. **Síntese do palpite (shareable `/p`).** Hoje o racional do narrador passa direto quando
   o usuário não moveu fator. Com nota, o racional cita o que a pessoa informou →
   `synthesisRationale` trata "tem nota" como "moveu": usa o racional montado em código
   (fatores do JEV que o usuário não moveu).
6. **Aviso do HERO.** Sem fator movido mas com nota → novo `CONTEXT_NOTED_NOTICE`
   ("não mudou os números, mas entrou no texto da análise como informação sua").
7. **Gravação.** `otherKind` entra nos schemas `checkedClaimSchema` e
   `StoredContextClaimSchema` (opcional: rows antigas seguem válidas). Enum, sem texto
   livre: `predictions.judgments.userContext` continua sem PII (ADR 0046).
8. **"Seu palpite".** Mesma extração (v2) e rótulo do subtipo na tela. O narrador do
   palpite **não muda** (já recebe a paráfrase cercada; mudar a linha exigiria bump de
   `user_palpite_narrate_v1` e `_live_v1` por ganho só cosmético).
9. **ADR 0055**: emenda (#569). ADR 0046: emenda de uma linha (extração v2, mesmo
   prefixo; notas do narrador são texto do código).

## Versões

- `user_palpite_extract_v1` → `v2` (prompt + tool).
- `narrator_v1.1` → `v1.2` (prompt + mensagem).
- `user_evidence_v1`, tag `;user=` do modelVersion, `user_palpite_narrate_*`: sem mudança
  (nenhum número novo).

## Testes

- `ClaimSchema`: `otherKind` só em `other`; enum inválido reprova; `normalizeClaimInput`
  descarta `otherKind` fora de `other`/vazio.
- `labels`: `otherKindLine`/`claimDescription`/`contextNotes` (dedupe, ignora sem kind).
- `applyUserClaims`: `notes` e `stored.claims[].otherKind`; sem efeito em evidence.
- Narrador: seção só com nota; mensagem sem nota idêntica à de antes.
- `synthesisRationale`: com nota e sem fator movido → racional do código.
- `analysisContextNotice`: nota sem fator → `CONTEXT_NOTED_NOTICE`.
- Schemas Stored* aceitam row antiga (sem `otherKind`) e nova.

## Ajustes do review do plano

- O aviso §6 só é verdade se a nota chega ao texto em todo mercado: o best bet narra por
  LLM só um mercado e o fallback é o template. Por isso `templatedNarration` também registra
  as notas no racional (só quando cabem inteiras, nunca cortadas), e o aviso fala de "texto
  da análise".
- Um predicado só, `hasContextNote` (`labels.ts`), pra síntese e aviso; `contextNotes` pro
  narrador. `notes` vive em `AppliedUserContext`, então o memo do run leva as notas a todo
  mercado.
- `normalizeClaimInput` também tira `otherKind` fora do enum (o `ClaimSchema` é `.strict()`
  e derrubaria a afirmação inteira).
- O narrador do "Seu palpite" fica byte-idêntico (`narrate-live.test.ts` fixa o hash): só as
  views usam `claimTopicLabel`.
- A regra 4 do `SYSTEM_PROMPT` muda em toda chamada (por isso o bump), mas a mensagem do
  usuário sem nota é idêntica à da v1.1 (teste).
