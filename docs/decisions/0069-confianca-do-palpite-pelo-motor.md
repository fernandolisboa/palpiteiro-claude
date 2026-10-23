# ADR 0069 — Confiança do palpite calculada pelo motor

## Status

Accepted (2026-10-23, #649). Emenda a ADR 0030 (a manchete palpite-first): o campo `confidence` deixa de ser saída do LLM.

## Contexto

O chip "Confiança baixa / média / alta" da manchete era escolhido livremente pelo LLM na síntese (`palpites_v11`, `palpites_live_v1`). Não havia régua, número por trás nem medição de acerto. O Fernando perguntou se dava pra "aumentar a confiança" de um palpite de zebra (Botafogo ganhando no Beira-Rio, 1–2). Pela forma como o rótulo era produzido, subir a confiança só seria possível maquiando o rótulo. Entre deixar como estava e calcular em código, ele escolheu calcular em código.

## Decisão

1. **O que a confiança mede.** A chance que o modelo estatístico dá ao **resultado** (vitória do mandante, empate ou vitória do visitante) do placar provável. O placar exato não entra, porque raramente passa de ~12% e todo palpite seria "baixa".
2. **Faixas fixas**, em pontos percentuais, com limites inclusivos (`PALPITE_CONFIDENCE_BANDS` em `lib/ai/palpites/confidence.ts`):

   | Faixa | Chance do resultado |
   | --- | --- |
   | baixa | abaixo de 40% |
   | média | de 40% a menos de 55% |
   | alta | 55% ou mais |

   Antes do jogo, um empate quase nunca passa de 33%, então palpite de empate sai baixa. A maioria das zebras também. Isso é a intenção.
3. **Fonte da probabilidade**, normalizada a Σ = 100:
   - **Pré-jogo:** primeiro a base do modelo por jogo (`match_model_snapshots.probabilities.match_result`, ADR 0052). Ela é igual para todo usuário e não carrega o contexto extra de ninguém. Sem base, usa a análise de 1X2 do motor `code_jev` do próprio run. A análise do motor LLM não serve, porque seria o LLM escolhendo a confiança de novo, um passo atrás.
   - **Ao vivo:** a matriz do placar final do modelo em jogo (`p1X2`), a mesma das leituras ao vivo.
   - **Sem fonte:** `confidence: null` e o palpite sai sem o chip.
4. **O LLM não escolhe mais.** O campo sai do schema Zod (`.strict()` agora o rejeita), do tool e dos prompts: `palpites_v12` e `palpites_live_v2`.
5. **Persistência sem migration**, no jsonb `palpite_sets.headline`:
   - `confidence`: a palavra, ou `null`;
   - `confidenceProbPct`: a chance em pp, ou `null`;
   - `confidenceSource`: `snapshot`, `analysis`, `live_matrix` ou `none`.

   Sets antigos não têm `confidenceSource`; isso os identifica como a palavra do LLM.
6. **Firewall (ADR 0030 §3) mantido.** A view (`PalpiteHeadlineView`) recebe só a palavra. `confidenceProbPct` não cruza para a página, para o `/p` nem para a imagem OG.
7. **Medição.** `/admin/motor/calibracao` ganha a seção "confiança do palpite": por era (motor × LLM antigo) e faixa, mostra n, jogos, chance prevista média e acerto do resultado contra o placar de 90 minutos. Entra só o pré-jogo liquidado, e só o set mais novo de cada jogo e usuário, o mesmo que a liquidação considera.

## Consequências

- O rótulo passa a ser verificável, e as faixas podem ser recalibradas quando houver amostra.
- "Aumentar a confiança" agora significa cravar um resultado mais provável. Um palpite de zebra continua com confiança baixa, e é isso que o chip deve dizer.
- Ao vivo, perto do fim do jogo, a confiança tende a "alta" porque a matriz satura. Por isso a calibração deixa o ao vivo de fora.
- Fica de fora desta ADR: um botão de "palpite seguro" e qualquer mudança na escolha do placar provável.
