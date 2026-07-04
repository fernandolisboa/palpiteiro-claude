# Report 05 — Legal, LGPD e config (páginas legais + links sociais)

> Plano de implementação da superfície legal/compliance + config (2026-07-04). Aterrado em
> `origin/main` e no spec já escrito em [`docs/ops/05-legal-compliance.md`](../ops/05-legal-compliance.md).
> Complementa a análise de risco regulatório do [Report 08](./08-concorrente-palpiteirofc-e-marca.md).

## Veredito geral

O app está **live em palpiteiro.live com cadastro aberto** (qualquer e-mail entra, self-provision
#257), mas a superfície de compliance especificada na §7 da ops-doc está **majoritariamente não
construída**: **não há** `/termos`, **não há** `/privacidade`, **não há footer global** (18+ / CVV
188 / não-é-casa-de-aposta), **não há linha de risco** no card de análise, e **não há caminho de
exclusão de dados LGPD** — pior, um delete ingênuo de usuário é **impossível** hoje porque
`ai_calls`/`predictions`/`palpite_sets` referenciam `users` com `onDelete:"restrict"`.

**O único pedaço já shipado é o gate 18+ no cadastro** (#282 CLOSED): checkbox obrigatório gateia
os 3 métodos de login e `acceptedTermsAt` é carimbado no `createUser` — mas o texto omite
Termos/Privacidade de propósito (TODO go-live), porque as páginas não existem.

**Takeaway nº 1:** com cadastro já aberto e live, **`/termos` + `/privacidade` + footer global são
os bloqueadores de go-live críticos e baratos** (conteúdo estático, R$0, horas). Tudo o mais empilha
em cima.

## Achados

| # | Prioridade | Achado |
|---|---|---|
| 1 | **crítica** | Sem `/termos` nem `/privacidade` — enquanto o cadastro está aberto a qualquer e-mail |
| 2 | **alta** | Sem footer global: 18+/jogo-responsável/CVV 188/não-é-casa-de-aposta ausentes de toda página autenticada e do `/signin` |
| 3 | **alta** | Sem caminho de exclusão LGPD — e as FKs `restrict` tornam o delete ingênuo impossível |
| 4 | **alta** | O matcher do middleware vai 307 as novas páginas legais pro `/signin` (só exclui `signin$`/`como-funciona$`/`$`) |
| 5 | média | Gate 18+ shipado (#282) mas o consentimento ainda não cobre Termos/Privacidade (TODO go-live) |
| 6 | média | Sem linha de aviso de risco na Análise sóbria (a manchete tem disclaimer, o card de análise não) |
| 7 | média | Sem links sociais em lugar nenhum e sem superfície de config runtime (só o singleton `ai_config`) |
| 8 | baixa | Inputs da política que a ops-doc sub-lista: Sentry é sub-processor vivo, OpenAI é key-gated; sem automação de retenção |
| 9 | baixa | Metadata raiz ainda descreve o produto como over/under 2.5 single-market |

Evidência-chave: `app/` sem `termos/`/`privacidade/`; `app/layout.tsx:29-46` (sem footer);
`db/schema.ts:256/288/441` (FKs restrict) vs `:168/189/218` (Auth.js cascade);
`middleware.ts:34-36`; `app/signin/sign-in-methods.tsx:34-73`; `components/analysis-result.tsx`;
`db/schema.ts:582-623` (singleton `ai_config`).

## Recomendações (dimensionadas, prontas pra virar issue)

### Bloco crítico (fazer primeiro — é gap de go-live vivo)
1. **`/termos` + `/privacidade` estáticas + liberação no middleware** · M · sem ADR
   Dois Server Components estáticos sem auth, usando o padrão de header público da landing
   (Wordmark + ThemeToggle — **não** `DesktopShell`, que assume sessão). Conteúdo direto das
   tabelas §4/§5 da ops-doc. Data como const exportada, forward-only (git = trilha de versão).
   **Middleware:** estender o negative-lookahead com `termos$|privacidade$` seguindo a convenção
   de âncora documentada. Contract tests espelhando o de `como-funciona`. **Pré-requisito das #2 e #3.**
2. **`SiteFooter` global no root layout** · S · sem ADR
   `components/site-footer.tsx` (Server Component) renderizado do `app/layout.tsx` logo após
   `{children}` pra TODA rota herdar (signin, landing, como-funciona, termos, privacidade,
   autenticadas). `body` vira `flex min-h-screen flex-col`, footer `mt-auto`. Conteúdo §7:
   selo 18+, "Aposte com responsabilidade. Aposta não é investimento.", links Termos/Privacidade/
   CVV 188/Jogadores Anônimos, "Palpiteiro é uma ferramenta de análise. Não é casa de apostas e
   não aceita dinheiro real." **Zero-DB por ora** (o slot de links sociais chega com o site_settings)
   pra a landing estática (#373) continuar estática. Dedupe a linha inline da landing. Corrige a
   metadata raiz stale de brinde.
3. **Estender o consentimento do `/signin` pra Termos + Privacidade** · S · sem ADR
   Depende da #1. Trocar o label do checkbox pra "Declaro ter 18 anos ou mais e aceito os Termos
   de Uso e a Política de Privacidade." com `<Link>`. **Gotcha:** o label inteiro é target de
   clique que toggla o checkbox — os links internos precisam de `stopPropagation` (ou ficar fora
   da área de toggle). Sem schema change (`acceptedTermsAt` já evidencia; + a data forward-only
   responde "qual versão estava no ar quando o usuário aceitou").

### Bloco alto
4. **Linha de aviso de risco no resultado da análise** · S · sem ADR
   Uma linha muted estática em `components/analysis-result.tsx` (e no fan-out
   `best-bet-results.tsx`): "Recomendação analítica, sem garantia de resultado. Aposte com
   responsabilidade." Const exportada (espelha `PALPITE_DISCLAIMER`). **Firewall:** superfície
   sóbria onde valor é sancionado — não toca a manchete. **Auditar goldens de string pinada antes.**
5. **Caminho real de exclusão de conta (direito de apagamento LGPD)** · L · **ADR**
   O ADR escolhe a estratégia porque o schema bloqueia delete ingênuo:
   - **Opção A** — cascade duro: destrói histórico de Yield e quebra o cost-accounting admin.
   - **Opção B (recomendada, e sancionada pela ops-doc §149** "histórico anônimo pode ser mantido
     se desidentificado"**)** — anonymize-and-keep: tira PII da row `users` (email→tombstone,
     name/image/acceptedTermsAt→null, allowed=false) ou re-aponta o histórico pra sentinela; Auth.js
     cascateia; deletar `verification_tokens` por identifier.
   - Superfícies: `/perfil` "Excluir minha conta" (danger zone + confirm → signOut) + variante admin.
   - **Landmines:** neon-http **não tem** `db.transaction` — orquestrar via `db.batch` de statements
     independentes; testes pglite provando sem-órfão/sem-PII; logs de Sentry/Vercel fora do controle
     → a `/privacidade` diz "expiram por política do provider".

### Bloco médio
6. **`site_settings` singleton (links sociais no footer) editável em `/admin/settings` — sem redeploy** · M · **ADR (curto)**
   *(Este é o teu item 6.)* Tradeoff de fonte de config:
   - **env vars** — falha o requisito: `NEXT_PUBLIC_*` é inlinado no build; mudar env na Vercel
     **exige redeploy** pra ter efeito. ❌
   - **Vercel Edge Config** — sem redeploy, mas adiciona provider/SDK novo + edição só no dashboard. ⚠️
   - **DB singleton** — reusa o padrão **provado** do `ai_config` (id PK default 1, form admin,
     server action, query tipada; comentários já dizem "flip data-driven, sem deploy"). ✅ **RECOMENDADO.**
   - **NÃO** enfiar em `ai_config` (é AI-scoped). Criar `site_settings` com `socialLinks jsonb`
     (array `{label, url}`), Zod-validado (https-only) na leitura E na action. **Detalhe crítico:**
     envolver a leitura em `unstable_cache(..., {tags:['site-settings']})` e chamar
     `revalidateTag('site-settings')` no save, pra as rotas estáticas que agora renderizam o footer
     continuarem estáticas/ISR e o cold-start do Neon (~1s) nunca cair no footer. Lista vazia = sem
     seção social (o footer ship antes disto).

### Bloco baixo
7. **Política escrita a partir do código, não da ops-doc** · S — listar Sentry (sub-processor vivo
   via túnel `/monitoring`) + OpenAI condicional (ADR 0027) + transferência internacional + retenção
   honesta ("enquanto a conta existir"). Fold no PR da `/privacidade`.

## Nota sobre decisões suas (da ops-doc §"Decisões abertas")
Ainda pendentes e suas: gate 18+ bloqueante vs só aviso (recomendação: só aviso na escala atual);
e-mail de contato do controlador (usar `contato@palpiteiro.live`); checkbox explícito vs implícito
(implícito ok na escala de amigos); identidade do controlador (pessoa física hoje — PJ/MEI é assunto
de monetização, ver [Report 07](./07-monetizacao.md)).

Relacionados: [`docs/ops/05-legal-compliance.md`](../ops/05-legal-compliance.md),
[`docs/ops/06-marca-inpi.md`](../ops/06-marca-inpi.md), ADR 0023 (auth aberto), 0027 (OpenAI seam).
