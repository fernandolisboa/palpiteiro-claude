# ADR 0064 — Progresso ao vivo do "Analisar com IA" por uma rota de streaming

## Status

Accepted (2026-10-23). Pedido do Fernando no thread "Progresso da análise com IA".

## Contexto

O "Analisar com IA" leva de segundos a alguns minutos (fan-out por mercado, JEV, narração, notícias, manchete; prazo de 270 s, ADR/#524). O HERO mostrava um skeleton e uma frase fixa ("lendo os mercados e montando o palpite…") até o fim. O pedido: mostrar o que está acontecendo de verdade, etapa por etapa.

A server action (`runPalpiteHero`) só devolve no fim: o `useActionState` não tem canal pra etapas intermediárias. Devolver um stream de dentro da action quebraria o `pending` e o `revalidatePath`, que o Next processa quando a action resolve.

## Decisão

1. **Rota `POST /api/palpite/run`** que roda a MESMA `runPalpiteHero` (gates, cobrança, fan-out, síntese) e devolve NDJSON: uma linha por etapa e, no fim, o resultado. Exceção consciente à convenção "server actions pra mutações" do CLAUDE.md: streaming é o motivo. Como a resposta sai antes do run terminar, o `revalidatePath` da action não tem efeito por este caminho (o Next aplica revalidações quando o handler devolve). Hoje não faz falta: as páginas são dinâmicas, não há cache por caminho, e o cliente faz `router.refresh()` no fim. Se algo passar a ser cacheado por caminho, a rota precisa revalidar por conta própria.
2. **Etapas reais, não um roteiro com timer.** O pipeline marca as etapas onde elas rodam (`lib/ai/progress/run-progress.ts`, `AsyncLocalStorage`): dados dos times, preços do mercado, Dixon-Coles, JEV, contexto extra, mercado escolhido, narração, mercados analisados pela IA, notícias, manchete e a conferência da manchete. Fora da rota (server action, crons, scripts) é tudo no-op, sem mudar assinatura nem resultado.
3. **Uma linha por etapa.** O agregador (`tracker.ts`) junta as instâncias da mesma etapa (cada mercado do fan-out relê dados e preços, em paralelo): abre na 1ª, fecha quando a última em voo termina, com o melhor desfecho (done > skipped > failed). Depois de "done", releitura do cache não reabre.
4. **A copy mora no servidor** (`steps.ts`), em português, sem termo ou número de valor (o HERO passa pelo `containsValueLanguage`: "preços do mercado", nunca "odds"), sem % nem dígito de tempo e sem nome de casa de aposta. Testada contra o mesmo guard.
5. **Segurança.** `/api/*` fica fora do middleware: a sessão é conferida dentro da action (`auth()`), e a rota confere a origem (`Origin` = host ou `x-forwarded-host`), que as server actions têm de graça. Cookie de sessão `SameSite=Lax` também não vai num POST de outro site.
6. **O run não depende do cliente.** A rota registra o run em `after()`: se a pessoa sair da página, ele termina e grava, como a server action terminaria. Batida (`ping`) a cada 15 s pra conexão não parecer ociosa durante uma chamada longa.
7. **Reserva.** O form mantém `action={runPalpiteHero}`: sem JS (antes da hidratação) o envio nativo vai pela server action, como antes. Com JS, se a rota responder 400/403/404/405/415 (provadamente não rodou nada; ex.: deploy antigo), o cliente cai na server action. Rede caída ou stream cortado não reenviam (o pedido pode ter chegado): o HERO avisa e relê a página.
8. **Fim do run.** Resultado ok (ou stream cortado) → `router.refresh()` numa transição; o HERO segue no estado de progresso até o palpite novo chegar pelas props, sem piscar o estado antigo.
9. **UI** (`components/palpites/palpite-progress.tsx`): linha do tempo na casca quente, ícone girando na etapa em andamento, check com zoom curto ao terminar, entrada de 4 px por linha. Sem brilho, gradiente ou piscada (DESIGN.md); `prefers-reduced-motion` desliga tudo. Região `role="status"` com a etapa em andamento.

## Alternativas rejeitadas

1. **Mensagens com timer no cliente** ("consultando…", "falta pouco…"). Rejeitada: o pedido é ver o que de fato rodou; um roteiro fixo mente quando o run pula ou falha uma etapa.
2. **Server action devolvendo um stream (Flight).** Rejeitada: a action resolveria antes do trabalho, o `pending` do `useActionState` cairia na hora e o `revalidatePath` chegaria depois da resposta.
3. **Progresso gravado no KV e lido por polling.** Rejeitada: mais comandos no Upstash, atraso do intervalo e uma segunda rota, sem ganho sobre o stream.

## Consequências

- Uma rota nova, sem tabela nem flag nova. O custo do run não muda (mesma action, mesmas chamadas pagas).
- Novas etapas entram com um `trackStep`/`beginStep` no ponto do pipeline e a frase em `steps.ts`.
