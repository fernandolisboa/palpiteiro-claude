# IDEIA (backlog) — Automatizar o disparo de kickoff numa sessão 100% nova

> **Status: ideia, NÃO fazer agora.** No palpiteiro só restam #229–#231 (wave multi-AI) +
> #246 (polish) — não compensa investir nisso. **Revisitar se aparecer mais fila de issues**,
> e/ou **reaproveitar em outros projetos** (a abordagem local é project-agnostic).
> Snapshot 2026-06-17. Honesto sobre o que é certo vs. a-verificar — não tomar como verdade absoluta.

## O problema

Quando o contexto de uma sessão chega perto de ~40%, o dono faz um ritual manual de 5 passos pra
começar do zero com contexto fresco:

1. `/exit`
2. `claude` (sessão nova)
3. `/effort ultracode`
4. `shift+tab` → auto mode (modo de permissão autônomo)
5. colar o **kickoff prompt** pra disparar o trabalho

Quer colapsar isso em algo automatizado/1-comando.

## Esclarecimento de "100% novo"

Uma "sessão nova" (manual ou agendada) NÃO é tábula rasa: ela zera o **context window** (não
carrega a conversa anterior), mas **re-bootstrapa** CLAUDE.md + auto-memory (MEMORY.md + memórias
recalled) + SessionStart hooks. Ou seja: "sessão fresca que conhece o projeto" — que é exatamente
o desejado. O ganho é zerar o contexto acumulado, não esquecer o projeto.

## Opções avaliadas

### 1. Scheduled cloud agent / routine (skill `/schedule`, deferred tool `CronCreate`)
- Cria um agente que roda **na NUVEM**, cron recorrente OU **run único** ("rode uma vez"). O kickoff vira a task.
- ✅ Context window 100% novo; ✅ autônomo por natureza (headless não tem humano pra aprovar → "auto mode" é inerente).
- ⚠️ **A VERIFICAR:** (a) dá pra **fixar `/effort ultracode`** por routine? (b) o **ambiente cloud tem os
  secrets/estado deste repo** — checkout, `gh` autenticado, `.env.local` (ANTHROPIC/DATABASE_URL/etc.),
  Neon? Hooks avisam que MCP/credenciais interativas podem faltar em runs headless/cron. Se faltar,
  a routine não roda `pnpm test`/`gh pr merge`/migrations como local.

### 2. Remote background agent (`Agent` com `isolation: "remote"` / `RemoteTrigger`)
- Lança um agente AGORA num ambiente cloud fresco, em background.
- Mesmas vantagens (contexto novo) e mesmas ressalvas de ambiente cloud da opção 1. Bom pra "dispara já", não "agenda".

### 3. Alias/script de shell LOCAL (recomendado pro fluxo atual do dono) ⭐
- Colapsa os 5 passos num comando só, na **mesma máquina** (mesmos secrets/repo/gh/DB), contexto local fresco:
  ```bash
  # ~/.zshrc (exemplo — flags A CONFIRMAR via `claude --help`)
  alias kick='claude --effort ultracode --permission-mode <auto?> "$(cat ./kickoff.txt)"'
  ```
- ✅ Sem a fragilidade de ambiente cloud; ✅ mais próximo do fluxo manual atual.
- ⚠️ **A VERIFICAR no `claude --help`:** existe `--effort`? qual o flag de permission-mode (auto/autônomo)?
  dá pra passar o prompt inicial como argumento posicional? Se sim → fresh session local, ultracode,
  autônomo, kickoff, em 1 comando.
- ➖ NÃO pode ser disparado por um agente (não há controle do terminal do dono) — é o dono quem roda o alias.

### 4. O que NÃO dá
- Um agente **dentro de uma sessão** relançar uma sessão LOCAL nova automaticamente — não há controle
  do terminal. O `/loop` (ScheduleWakeup) re-invoca na MESMA sessão (não zera o contexto), então NÃO serve.

## Homework pra quando revisitar

1. `/schedule` (ou `CronCreate`): (a) suporta pin de effort=ultracode? (b) o ambiente cloud recebe os
   secrets/repo/gh/DB deste projeto? Se ambos sim, a routine cloud vira viável pra trabalho real.
2. `claude --help`: flags reais de **effort**, **permission-mode** e **prompt inicial** → montar o alias da opção 3.
3. Decidir: kickoff num arquivo versionado (`kickoff.txt`/handoff) que o alias lê, por projeto.

## Reaproveitamento cross-project

A **opção 3 (alias local)** é genérica: copiar o padrão pra qualquer projeto nosso, trocando só o
conteúdo do kickoff (que aponta pro handoff daquele projeto). A opção 1/2 (cloud) depende de
provisionar secrets por projeto.

## Caso de uso imediato (se algum dia automatizar)

O kickoff da wave multi-AI já está pronto em `docs/handoffs/HANDOFF-229-231.md` (+ o bloco copiável
emitido na sessão de 2026-06-17) — seria o primeiro candidato a disparar via alias/routine.
