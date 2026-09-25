# ADR 0041 — Camada de julgamentos JEV (TypeSafe) entre o modelo estatístico e o gate de edge: o código decide, o JEV ajusta, o LLM narra

## Status

Proposed (2026-09-24). Issue #501. Revisado no mesmo dia: a implementação não espera o backtest (pedido do Fernando).

O desenho foi escolhido pelo Fernando entre três opções:

| Opção | Resultado |
| --- | --- |
| **Código + JEV** | **Escolhida** |
| JEV direto | Rejeitada (Alternativa 1) |
| Deixar o backtest escolher | Rejeitada |

Este ADR pede um provider de IA novo, a TypeSafe, e por isso precisa de ADR (CLAUDE.md, "O que NÃO fazer"). Ele também tira do LLM a autoria da probabilidade que vira aposta.

**Depende de:**
- **ADR 0039 (Fase C).** Dixon-Coles como fonte de λ, mais o backtest em temporadas passadas. A thread da Fase C é dona do loader/runner compartilhado em `lib/backtest/` + `scripts/backtest/`.
- **ADR 0037.** Camada Poisson.
- **ADR 0038.** Gate de edge.

**Não toca:**
- o firewall da manchete nem o registro Palpite (ADR 0028);
- o grade-my-bet (ADRs 0034/0036).

> **Escopo:** decisão de arquitetura, plano de implementação e plano de validação. Este PR só traz o ADR. A implementação entra em PRs separados, **atrás do flag `analysis_engine`** (Decisão 5), que começa em `llm`. O backtest (Decisão 7) roda em paralelo e **não bloqueia** a implementação: ele calibra os pesos e informa quando virar o flag. Virar o flag é decisão do Fernando.

## Contexto

### Pipeline atual

Cada mercado é um `predict()` (`lib/ai/predict.ts`) com Sonnet 4.5 a temperatura 0.3 e tool forçada. O LLM devolve cinco campos:

- `recommendation`;
- `confidence_pct`, ou a distribuição completa em 1X2 (`prob_home/draw/away`);
- `rationale` em PT-BR;
- `key_factors`;
- `minimum_odd`.

O caminho até a aposta:

1. `cartridge.selectionProbs(output)` (`predict.ts:947`) transforma a saída do LLM na **probabilidade do modelo**.
2. Essa probabilidade menos a implícita de-vigada dá o **edge** (`:961-1000`).
3. O edge passa pelo gate (ADR 0038) e vai pro staking (`staking.ts:34-42`).

O Poisson (`lib/quant/scoreline-model.ts`, `computeMatchLambdas` em `lib/providers/sports-data/match-lambdas.ts:61`) só entra como **fato no prompt** do over/under (ADR 0037). O número que vira aposta é o do LLM.

### Problemas

1. **Não-reprodutibilidade.** O mesmo jogo, com os mesmos dados, pode sair com probabilidades e lados diferentes entre chamadas. A decisão que gera Yield não é auditável como função dos insumos.
2. **Aritmética delegada ao LLM.** Probabilidade de gol é matemática. Hoje o código já tem a matemática, mas o LLM "ancora" nela e reescreve o número.
3. **Custo e latência lineares em mercados.**
   - Cada análise custa ~US$ 0,0169 por mercado: ~3.368 tokens de input e ~449 de output (`docs/discovery/perf-cost-scaling.md:27-35`).
   - O best bet roda até 6 `predict()` **em série** (`lib/ai/best-bet.ts:75-88`).
   - O gate rebaixa pra pass **depois** da chamada paga.
4. **Validação impossível ao vivo.** O Fernando é praticamente o único usuário. O gate de 150 apostas liquidadas da Fase C não chega em prazo útil. Por isso a validação migra pra backtest, como no ADR 0039.

### O que é o JEV

O JEV é o `jev-1.13`, modelo "System One" da TypeSafe. Fonte: `docs.typesafe.ai`, lida em 2026-09-24.

- **Entrada e saída.** Recebe um `state` (texto/JSON) e perguntas tipadas, e devolve respostas estruturadas:
  - `choice`: opção de uma lista, com probabilidade por opção;
  - `score`: nota numa rubrica;
  - `noul`: um valor 0–1 de a afirmação ser verdadeira;
  - cada resposta vem com `confidence`.
- **Treino.** É treinado por RLCD para dar **probabilidades calibradas em julgamentos**, e é "self-consistent": o mesmo input dá praticamente a mesma saída.
- **Preço e limites.**
  - US$ 0,042 por **milhão** de tokens de input; o output é grátis.
  - ~100 ms por chamada.
  - Contexto de 64k.
  - 1.200 req/min, "ajustando dinamicamente".
- **Não gera texto.**
- **Fraquezas declaradas** (página "Jev 1.13 jaggedness"):
  - números ("keep the arithmetic in code");
  - comparação de datas;
  - estado grande com ruído;
  - leitura literal;
  - inglês é a língua primária.

A doc recomenda exatamente a divisão deste ADR: **código no controle, o modelo só onde há julgamento sobre dado não estruturado.**

## Decisão

### 1. Três papéis, uma direção de dados

O pipeline passa a ser:

```
dados (fixture, forma, tabela, desfalques, calendário)
  → [código] features + buckets semânticos
  → [JEV]    julgamentos qualitativos (nouls/choices), 1 chamada por jogo
  → [código] λ_base (Poisson hoje / Dixon-Coles com o ADR 0039) × ajustes limitados = λ_adj
  → [código] matriz de placar → P(seleção) em TODOS os mercados partition do jogo
  → [código] edge vs implícita de-vigada (ADR 0018) → gate (ADR 0038) → staking
  → [LLM]    racional + key_factors da decisão JÁ TOMADA (não pode mudá-la)
```

- **O número que vira aposta é sempre do código.** O JEV nunca emite probabilidade de resultado. Ele emite a probabilidade de um *fato qualitativo* ser verdade, e o código converte isso em ajuste de λ.
- **Uma chamada JEV por jogo, não por mercado.** Todos os mercados partition (1X2, over/under em todas as linhas, BTTS, dupla chance) saem da **mesma** matriz ajustada. Isso é coerente com o ADR 0036 §4.
- **Scorer/assist ficam fora** e seguem no caminho atual. São `independent_binary`, sem matriz.

### 2. Contrato das perguntas JEV: `jev_judgments_v1`

O conjunto de perguntas é fixo e versionado como um prompt: bump de versão e commit `prompt:` (ADR 0017). Vive em `lib/ai/judgments/`.

**Regras do `state`** (obedecem à jaggedness):

- **Em inglês**, só com os campos que as perguntas usam.
- **Buckets nomeados em vez de números.** O código converte os números antes de enviar, por exemplo:
  - dias de descanso → `"short rest (<72h)"`;
  - posição na tabela → `"relegation zone"`, `"title race"`, `"safe mid-table"`;
  - rodada → `"final 5 rounds"`.
- **Datas** são comparadas no código, nunca pelo JEV.
- **Desfalques vão por papel, sem nome de jogador.** Exemplos: `"starting striker, team top scorer"`, `"first-choice goalkeeper"`. O papel é derivado no código dos dados do provider de desfalques (`lib/providers/absences/`, ADR 0026). Motivo: minimização (§ LGPD) e menos distrator.

**Perguntas v1** (todas noul, uma por time quando aplicável):

| Chave | Pergunta (literal, sem negação) | Efeito no código |
| --- | --- | --- |
| `attack_weakened_{home,away}` | "The absences listed for this team remove a first-choice attacking player who is central to how the team scores." | ↓ λ do próprio time |
| `defense_weakened_{home,away}` | "The absences listed for this team remove a first-choice defender or the first-choice goalkeeper." | ↑ λ do adversário |
| `rotation_risk_{home,away}` | "Given the fixture context, this team is likely to field a rotated or weakened lineup in this match." | ↓ λ do próprio time |
| `high_stakes_{home,away}` | "Given the league situation described, this match has high stakes for this team (title, qualification or relegation)." | ↑ λ do próprio time (leve) |

Cada noul carrega `criteria` com os casos de borda escritos, como pede a jaggedness #1.

### 3. Conversão em ajuste: limitada, monotônica, no código

- **Cada fator k** vira um multiplicador **unilateral** de λ: `m_k = 1 + w_k · max(0, noul_k − 0.5) · 2`. A saída fica entre 1 e `1 + w_k`, e `w_k` carrega o sinal da coluna "Efeito" da tabela.
  - Só o "sim" move λ. Um noul ≤ 0.5 ("não há desfalque", "não há rotação") deixa o multiplicador em 1.
  - Motivo, visto na implementação (#510): a forma simétrica `(noul − 0.5) · 2` fazia a resposta típica "não" de um jogo sem desfalques subir λ em ~1,5%. Isso é um viés sistemático, não informação.
- **Clamp por time:** `Π m_k ∈ [0.85, 1.15]`. O JEV **nunca** move um λ mais de ±15%. Com os pesos v1, o pior caso fica em [0,893; 1,092], então o clamp é uma guarda pra quando os pesos forem retunados.
- **Pesos iniciais:** `|w_k| ∈ {0.06 ataque, 0.06 defesa, 0.05 rotação, 0.03 motivação}`.
  - São priors conservadores, ajustados no backtest (Decisão 7).
  - Os pesos são **código versionado** (`judgment_weights_v1`), nunca aprendidos em runtime.
- **Sem gating por confidence.** A API não devolve `confidence` pra noul, e a distância de 0.5 já mede a força do sinal. O `confidence` fica só no log, caso a API passe a mandar.
- **Fail-open para o estatístico puro.** Se o JEV falhar (erro, timeout de 3 s, 429 ou chave ausente), o fluxo segue com λ_base. O campo `judgmentsApplied=false` é persistido. O JEV nunca bloqueia uma análise.

### 4. O LLM vira narrador: cartucho `narrator_v1`

- **Input do LLM:** a decisão já tomada. Isso inclui mercado, seleção, probabilidade do modelo, implícita, edge, stake ou pass, os julgamentos JEV aplicados (em PT-BR, como fatores) e os mesmos dados de contexto de hoje.
- **Output:** só `rationale` e `key_factors`, com validação Zod `.strict()`.
  - Não há campo de probabilidade nem de lado.
  - O LLM **não tem como** alterar a decisão.
  - Um `fidelity check` em código rejeita um racional que cite um número diferente do persistido, no mesmo espírito de `lib/ai/palpites/fidelity-validator.ts`.
- **Uma chamada narradora por análise**, não por mercado candidato.
  - No best bet, o código avalia todos os mercados de graça e o LLM narra só o escolhido. O fan-out cai de até 6 chamadas pagas pra 1.
  - Isso **resolve o #492 por construção**: um slot de rate-limit por mercado deixa de fazer sentido.
- **Modelo:** começa em Sonnet 4.5. O Haiku 4.5 (~3× mais barato) é candidato, decidido por uma comparação cega de 30 racionais, sem ADR novo. Trocar o modelo do narrador não altera a decisão.
- **Pass gateado.** Continua com `GATED_PASS_RATIONALE` (ADR 0038). Um pass autorado pelo código ganha racional narrado do "por que não há valor".

### 5. Fronteiras de código

- **Cliente HTTP:** `lib/ai/providers/typesafe/`, via `@typesafe-ai/sdk` ou fetch direto.
  - É **o único** lugar que fala com `api.typesafe.ai`.
  - Chave em `TYPESAFE_API_KEY`.
  - Modelo **pinado** em `jev-1.13.0`, nunca `jev-latest`: o alias move e muda as respostas (doc "Models"). O upgrade é um bump deliberado, seguido de re-backtest.
- **Seam próprio, estreito:** `JudgmentProvider = { hasKey(): boolean; judge(state, questions): Promise<JudgmentResult> }`.
  - **Não** é o `AIProvider` do ADR 0027, porque esse pressupõe LLM com tool calling e texto.
  - Segue o precedente do seam estreito de desfalques (ADR 0026).
- **Porta de entrada única:** só `lib/ai/predict.ts` chama `judge()`, e loga em `ai_calls`:
  - `provider='typesafe'`;
  - `promptVersion='jev_judgments_v1'`;
  - tokens de input, output 0;
  - `costUsd` pela tabela de preço do registry.

  A invariante "toda chamada de IA passa por `predict.ts` e loga" continua valendo (CLAUDE.md).
- **Flag de motor:** `analysis_engine ∈ {llm, code_jev}` é uma coluna aditiva em `ai_config`, ao lado de `enableClvCapture`, lida e gravada por `lib/db/queries/ai-config.ts`. Começa em `llm` e é **editável na tela de admin**, sem env var e sem deploy: é o padrão pedido pelo Fernando pra chaves desse tipo.
  - `modelVersion` e `promptVersion` das predições passam a carregar o motor. Exemplo: `engine=code_jev;lambda=poisson_v1;judg=jev_judgments_v1;w=v1;narr=narrator_v1`.
  - Com isso, a calibração e o Yield segmentam por motor.

### 6. Persistência

- As tabelas `predictions` e `prediction_selection_odds` não mudam de forma.
  - `modelProbPct` passa a ser o número do código.
  - `confidencePct` = P(seleção recomendada).
- Uma coluna `judgments jsonb` nullable em `predictions` guarda:
  - os nouls e as confidences recebidos;
  - os multiplicadores aplicados;
  - λ_base e λ_adj;
  - `judgmentsApplied`.

  A decisão fica **recomputável** a partir do registro. Isso ecoa a Decisão 4 do ADR 0038 e é a garantia de auditabilidade que motivou a mudança.
- Nunca mutar predições passadas. O motor novo só afeta análises novas.

### 7. Validação: backtest em paralelo à implementação

**Setup**

- Loader e runner compartilhados com o ADR 0039, com estratégias plugáveis `(match, features) => { p1x2?, pOver25? }`.
- **Odds de fechamento:** snapshot versionado de `football-data.co.uk/new/BRA.csv`.
  - Contém 1X2 de 2012 a 2026, com 277 jogos de 2026 até 20/09.
  - A PSC (Pinnacle) tem prioridade; o fallback é AvgC, porque a PSC está vazia em 2026.
  - O CSV **não tem over/under**. O `pOver25` é avaliado só por log-loss contra o resultado, sem CLV.

**Estratégias comparadas, nos mesmos jogos**

| Estratégia | Descrição |
| --- | --- |
| **S0 mercado** | Implícita de-vigada de fechamento |
| **S1 estatístico** | λ_base: Poisson hoje e DC quando existir |
| **S2 código+JEV** | λ_adj deste ADR |
| **S3 LLM atual** | Cartucho `match_result` de hoje, amostra de ≤ 120 jogos (~US$ 2) |

**Janela e vazamento**

- **Só temporada 2026**, depois do corte de treino do Sonnet 4.5, para não medir memória do placar.
- O JEV julga desfalque e contexto, não o resultado. O risco de vazamento dele é menor, mas a janela é a mesma.

**Insumos históricos**

- Desfalques históricos por fixture vêm da API-Football (`/injuries?fixture=`), em cache local do run. O consumo de quota é checado antes do run.
- Rotação e motivação saem do calendário e da tabela point-in-time, derivados do próprio loader.

**Leituras que o backtest entrega**

Não são portões de merge. São os números mostrados pro Fernando antes e depois de virar o flag, e o insumo pra ajustar os pesos da Decisão 3:

1. **S2 vs S1:** diferença de log-loss 1X2, com IC 95% por bootstrap. Se o JEV não melhorar o estatístico, os pesos tendem a zero, e o motor passa a funcionar como `code` puro sem mudança de arquitetura.
2. **S2 vs S3:** log-loss de S2 contra o LLM atual, na mesma amostra. Mostra quanto se ganha ou se perde em qualidade ao trocar.
3. **CLV:** CLV médio das apostas que S2 **autoraria** (edge ≥ piso contra a odd de abertura, ou AvgC quando não houver abertura).
4. **Estabilidade:** variação de P(seleção) ao rodar S2 duas vezes no mesmo jogo. O esperado é ≤ 0,5pp. Isso mede a consistência alegada do JEV.

**Custo estimado do backtest:** JEV em ~277 jogos a ~2k tokens dá < US$ 0,05; S3 fica em ~US$ 2; a API-Football entra dentro da quota.

### 8. Rollout (PRs pequenos, tudo atrás do flag)

1. Cliente TypeSafe, módulo `lib/ai/judgments/` e pesos, com testes unitários da conversão e do clamp.
2. Motor `code_jev` atrás do flag, com o cartucho `narrator_v1` e a coluna `judgments`.
3. Best bet no motor novo: avaliação em código de todos os mercados e 1 narração.
4. `/admin/calibration` segmentado por motor.
5. Virar o flag. É decisão do Fernando e pode acontecer a qualquer momento depois do passo 2. Voltar é trocar o flag, sem deploy.

## Consequências

**Ganhos esperados** (estimativas; o backtest confirma a qualidade):

| Aspecto | Hoje | Motor `code_jev` |
| --- | --- | --- |
| Reprodutibilidade | Varia entre chamadas | Mesma entrada ⇒ mesma decisão, a menos de ~0,5pp do JEV |
| Custo por análise simples | ~US$ 0,017 | ~US$ 0,0001 (JEV) + narrador (~US$ 0,006–0,017 conforme Haiku ou Sonnet) |
| Custo do best bet | até ~US$ 0,10 | ≤ ~US$ 0,017 |
| Latência do best bet | até 6 chamadas LLM em série | ~100 ms (JEV) + 1 chamada LLM |
| Explicabilidade | O racional reflete o que o LLM "pensou" | O racional explica um número auditável, e os julgamentos JEV aparecem como fatores nomeados |

**Custos e riscos:**

- **Provider novo.**
  - Os limites da TypeSafe estão "ajustando dinamicamente".
  - O fail-open (Decisão 3) é obrigatório, não opcional.
  - O billing é pré-requisito, e a chave vai no Vercel e no ambiente de dev.
- **Teto de qualidade.**
  - O motor fica limitado ao estatístico + ajustes de ±15%.
  - O LLM hoje pode "ver" coisas fora do modelo. O backtest (leitura 2) mostra quanto isso vale.
- **Pesos são um modelo.** Precisam de re-backtest a cada bump do JEV ou do λ_base.
- **Cobertura de mercados.** O motor novo só cobre mercados partition derivados de placar. Os caminhos atuais de scorer/assist, cartões (ADR 0033) e palpite não mudam.

## Relação com a Fase C (ADR 0039)

- O JEV fica **entre** o λ estatístico e o gate, e é agnóstico à fonte de λ.
  - Com Poisson heurístico, funciona hoje.
  - Com Dixon-Coles, herda a melhoria sem mudança.
- Kelly fracionário (rec. 7) consome `modelProbPct`. No motor `code_jev`, esse valor é o número do código, o que é mais adequado pra Kelly que o `confidence_pct` do LLM.
- O gate de dados da Fase C (≥150 apostas liquidadas) não se aplica a este ADR. A validação dele é o backtest da Decisão 7, que roda em paralelo. Os mesmos dados e o mesmo loader servem aos dois ADRs.

## Revisão legal (LGPD, Lei 13.709/2018; Lei 14.790/2023)

- **Dados pessoais no state do JEV:** nenhum.
  - Desfalques vão por **papel** ("starting striker"), sem nome de atleta.
  - Informação de lesão de pessoa identificada seria **dado sensível** referente à saúde (art. 5º, II), e o tratamento dela exigiria base do art. 11.
  - Enviar só o papel cumpre a minimização (art. 6º, III) e afasta o art. 11.
  - Sem dado pessoal, a transferência internacional pra TypeSafe (EUA, arts. 33–36) não se aplica.
- **Achado colateral, fora do escopo deste ADR:** o fluxo atual já envia **nomes de atletas lesionados** ao LLM (Anthropic) no prompt de `predict()`.
  - Aqui cabe o art. 7º, §4º: os dados foram tornados manifestamente públicos pelos clubes e pela imprensa. A finalidade é análise esportiva, e o registro não fica associado ao atleta.
  - Ainda assim, o narrador (Decisão 4) deve receber papéis, não nomes, quando isso não empobrecer o racional.
  - Isso fica registrado como item pra issue de implementação 2.
- **Lei 14.790/2023:** o enquadramento do Palpiteiro como ferramenta de análise, sem vínculo a operador (ADRs de compliance e PR #500), não muda. Trocar o motor de decisão não cria intermediação de aposta.
- **Termos e privacidade:** sem dado pessoal enviado à TypeSafe, a TypeSafe não entra como suboperador na política de privacidade. Se um dia o state incluir texto de usuário, isso passa a exigir atualização da `/privacidade`.

## Alternativas consideradas

1. **JEV direto, com probabilidade de resultado.** Seria um `choice` home/draw/away sobre as estatísticas. **Rejeitada.**
   - Contraria a própria doc do JEV (números e aritmética no código).
   - A calibração RLCD é de julgamentos, não de previsão de evento esportivo.
   - Não há como limitar o dano de um erro.
2. **JEV substituindo o LLM por completo.** **Rejeitada.** Não gera o racional, que é central na UI (`components/analysis-result.tsx`) e é input verbatim da síntese do palpite (ADRs 0030/0031).
3. **JEV só em shadow ao lado do motor atual, sem backtest.** **Rejeitada.** Com um único usuário, o volume nunca dá leitura.
4. **Motor `code` puro, sem JEV.** **Não descartado.** É o que o motor vira, na prática, se o backtest zerar os pesos (leitura 1).
5. **Blend `w·P_estatístico + (1−w)·P_LLM`.** Mantém a não-reprodutibilidade e o custo por mercado. O ADR 0037 (Decisão 4) já o adiou.
