# PLAN-579: telas públicas (linhas 25 e 27 da revisão de design)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Referências conferidas no código em `2f050fd` (= `origin/main`, com #574, #575 e #578 mergeados) e na branch do PR 3 (#576: `63c7ef5` ADR 0057 + `d1e458e`, 2 commits à frente de `origin/main`, ainda não mergeado). Issue: #579 ("Revisão de design 6/6: landing, login e Como funciona reescritos"). Depende da parte 2 (#575, ADR 0056), já em main. **A "Revisão do plano" no fim vale sobre o resto.**

Regras herdadas dos PLAN-574/575/576: nenhum nome, link ou logo de casa de apostas (ADR 0048 D2/D3); nenhuma alegação de acerto ou desempenho em página pública (ADR 0048 D4, ADR 0056 D4); não mexer em prompt (`lib/ai/**`), seed nem `lib/view/markets/presentation.ts`; avisos obrigatórios ficam onde a ADR 0048 manda (18+, "não é casa de apostas" e jogo responsável no **rodapé global**, `components/site-footer.tsx`); vocabulário de tela da ADR 0056 (Sem aposta, retorno, taxa de acerto, jogos sem aposta, vantagem … pontos, Total de gols · Mais de 2,5, vírgula decimal).

Fronteiras de escopo: a página do jogo é o PR 3 (#576, em andamento na mesma árvore); `/apostas`, bolão, listas e desempenho são o PR 4 (#577). Este PR **não** muda a estrutura dessas telas; só lê componentes compartilhados delas. Texto legal de `/termos` e `/privacidade` não muda (só a classe do contêiner, para o rodapé alinhar).

## Ordem sugerida (commits)

1. `docs:` ADR nova curta (**próximo número livre no merge**: hoje 0058; a ADR do ao vivo, #580, está planejada e pode pegar antes; o PLAN-577 não prevê ADR) + `DESIGN.md`. Registra: (a) na landing o aviso é só o rodapé global; (b) imagens de produto em telas públicas são ilustrações renderizadas em código, com dados fictícios e rótulo "exemplo ilustrativo", sem odd, stake, vantagem, R$ nem resultado do app; (c) marca só "palpiteiro"; (d) o rodapé segue a largura da coluna da página; (e) exceção de cor para a marca do Google (hex oficiais só no SVG do "G").
2. Marca só "palpiteiro" (linha 25, item marca): `Wordmark` sem sufixo e os três usos.
3. Rodapé alinhado à coluna (linha 25, item rodapé): `PageContainer` com `data-page-width`, regra CSS com `:has()`, geometria do rodapé, marcadores em `/signin`, `/termos`, `/privacidade`, `/como-funciona` em `PageContainer`.
4. Login (linha 27): um campo de e-mail, frase do bloqueio do 18+, logo do Google.
5. Landing (linha 25): texto, três blocos com ilustração, um aviso só, metadata.
6. Como funciona (linha 25): índice, um bloco por conceito, "ver a conta", Dixon-Coles, Suas apostas, bolão, sem o "Temporariamente indisponível", vocabulário da ADR 0056 no corpo e limpeza do glossário.
7. Conferência final: `pnpm test && pnpm lint && pnpm typecheck && pnpm build` + revisão visual (390 e 1440, claro e escuro) + os três logins num preview.

Cada commit deixa `pnpm test`, `pnpm lint` e `pnpm typecheck` verdes. Os commits 4, 5 e 6 são independentes entre si (podem virar PRs separados se o diff ficar grande; recomendo um PR só, como as partes anteriores).

---

## Linha 25a: marca só "palpiteiro"

**Arquivos e mudanças exatas.**
- `components/wordmark.tsx`: tirar as props `suffix` e `suffixClassName` e o `<span>` do sufixo (`:5-10`, `:18`, `:24-33`). Fica `Wordmark({ className })`. Atualizar o comentário do topo ("marca única, sem sufixo; revisão de design linha 25"). Sem sufixo no tipo, o TypeScript impede a volta.
- `app/page.tsx:70`: `<Wordmark suffix="edge multi-mercado" … />` → `<Wordmark />` (o header da landing muda mais no commit 5).
- `app/signin/page.tsx:32`: `<Wordmark suffix="· edge multi-mercado" />` → `<Wordmark />`.
- `components/app-shell.tsx:75-78`: `<Wordmark suffix="v0 · edge multi-mercado" suffixClassName="hidden 2xl:inline" />` → `<Wordmark />`.
- `app/landing-content.tsx:13-17` (comentário que chama "edge multi-mercado" de framing sancionado): sai junto com a reescrita do commit 5.

**Testes.** `pnpm typecheck` pega qualquer uso restante. No teste da landing (commit 5) e em `__tests__/public-page-titles.test.ts`: a metadata da landing não contém "edge" (ver commit 5).

**Riscos.** `components/app-shell.tsx` é o cabeçalho de todas as telas logadas; o PR 3 não lista esse arquivo, mas conferir conflito no rebase. README/CLAUDE.md/docs de ops continuam dizendo "motor de seleção de edge multi-mercado": é documentação interna, não tela; fica.

---

## Linha 25b: rodapé alinhado à coluna do conteúdo

### Diagnóstico (medido na revisão, 1440px)
O rodapé (`components/site-footer.tsx:28-29`) é `px-6` por fora e `max-w-content` (1040) por dentro: o texto começa em x=200. O conteúdo começa em x=232 nas listas (`PageContainer`: `max-w-content` **com** `px-5 lg:px-8` por dentro, border-box), x=424 na landing (`max-w-reading px-6`) e x=530 no login (`max-w-form` dentro de `px-5`). Larguras diferentes por tela (content 1040, reading 640, form 380) e gutters diferentes: nunca alinha.

### Abordagem recomendada: o rodapé segue a largura da página por CSS
Sem mapa de rotas e sem JS: a página declara a largura no contêiner e o rodapé lê por `:has()`.
- `components/page-container.tsx:25-31`: adicionar `data-page-width={width}` no `<div>`. Atualizar o comentário ("telas logadas de usuário **e públicas**").
- `components/site-footer.tsx:28-29`:
  - `<footer>`: tirar o `px-6` (fica `border-t border-border-subtle py-8 text-muted-foreground`).
  - `<div>` interno: `mx-auto flex w-full max-w-content flex-col gap-3 px-5 lg:px-8` + `data-footer-column`. Mesmas classes de geometria do `PageContainer` → mesmo x nas telas `content`.
- `app/globals.css` (fora de `@layer`, de propósito: CSS sem camada vence as utilities do Tailwind v4, que ficam em `@layer utilities`). **Corrigido na revisão** (ver R1 e R2): as variáveis levam fallback literal e o `form` soma o gutter em vez de usar `content-box`:
  ```css
  /* Rodapé alinhado à coluna da página (#579): a página marca a largura no contêiner
     (PageContainer ou data-page-width). Sem marca, ou sem suporte a :has(), fica content.
     Fallback literal: o @theme é `inline`, então --container-reading/--container-form não
     são emitidas no :root (max-w-reading compila para 640px). Ordem importa: form por último. */
  body:has([data-page-width="reading"]) [data-footer-column] {
    max-width: var(--container-reading, 640px);
  }
  /* Login: gutter px-5 FORA da coluna de 380px; o rodapé tem o gutter dentro (border-box),
     então a largura máxima é a coluna + os dois gutters. */
  body:has([data-page-width="form"]) [data-footer-column] {
    max-width: calc(var(--container-form, 380px) + 2.5rem);
  }
  @media (width >= 64rem) {
    body:has([data-page-width="form"]) [data-footer-column] {
      max-width: calc(var(--container-form, 380px) + 4rem); /* lg:px-8 */
    }
  }
  ```
  Conta do `form` (border-box, `w-full px-5 lg:px-8`): 390px → largura 390 (< 420), texto em x=20 = login; 800px → caixa 420 centrada em 190, texto em 210 = (800−380)/2; 1024px → caixa 444 em 290, texto em 322 = (1024−380)/2; 1440px → caixa 444 em 498, texto em 530. O `content-box` do rascunho estourava no celular: com `w-full` a largura de conteúdo ia a min(390, 380) = 380 e o padding somava 40 → caixa de 420px numa tela de 390 (rolagem horizontal no `/signin`).
- Marcadores nas páginas que não usam `PageContainer`:
  - `app/signin/page.tsx:30`: `<div className="flex w-full max-w-form flex-col gap-6" data-page-width="form">`.
  - `app/termos/page.tsx:41` e `app/privacidade/page.tsx:54`: `px-6` → `px-5 lg:px-8` e `data-page-width="reading"` no `<main>` (só classe/atributo; texto legal intocado; os cabeçalhos `px-6` dessas duas páginas também viram `px-4 lg:px-8`, igual ao `AppHeader`).
  - `app/como-funciona/page.tsx:29`: `<div className="mx-auto w-full max-w-reading px-6 py-8">` → `<PageContainer width="reading">` (ganha o atributo de graça).
  - Landing: `PageContainer width="content"` (commit 5).
- Rotas sem marca (admin, 404, `/p` que esconde o rodapé) ficam em `content`, como hoje.

**Alternativa considerada:** mapa `pathname → largura` dentro do `SiteFooter` (que já é client por causa do `usePathname`). Rejeitada como padrão: duplica a decisão de largura que cada página já toma no `PageContainer` e quebra em silêncio quando o PR 4 mudar a largura de `/apostas` ou do bolão. O `:has()` acompanha sozinho. Suporte: Chrome 105+, Safari 15.4+, Firefox 121+; sem suporte, o rodapé fica em `content` (o comportamento de hoje, só com o gutter certo).

**Testes.**
- Novo `components/__tests__/site-footer.test.tsx` (`vi.mock("next/navigation", () => ({ usePathname: () => "/" }))`, `renderToStaticMarkup`): o rodapé tem `data-footer-column` e as classes `max-w-content px-5 lg:px-8`; carrega "18+", "Aposte com responsabilidade. Aposta não é investimento.", "Não é casa de apostas e não aceita dinheiro real.", CVV 188, Jogadores Anônimos, `/termos`, `/privacidade`, mailto de contato; com `usePathname` = `/p/abc` não renderiza nada. **Este teste passa a ser a trava legal da landing** (o teste da landing hoje exige "18+" e "Não é casa de apostas" no corpo; esse aviso sai, ver linha 25c).
- `components/__tests__/page-header.test.tsx` (ou teste novo do `PageContainer`): `data-page-width="reading"`/`"content"` no markup.
- Guarda de fonte (no mesmo `site-footer.test.tsx`, lendo `app/globals.css`): as regras `body:has([data-page-width="reading"|"form"]) [data-footer-column]` existem, cada `var(--container-…)` tem fallback literal, a regra `form` vem depois da `reading`, e não há `content-box`; `app/signin/page.tsx`, `app/termos/page.tsx`, `app/privacidade/page.tsx` têm `data-page-width`.
- No `pnpm build`: conferir no CSS gerado (`.next/static/css/*.css`) que as três regras saíram (o Tailwind/Lightning CSS não as descarta) e que o `max-width` resolve.

**Riscos.** `page-container.tsx` e `globals.css` não estão no PLAN-577, mas o PR 4 cria `app/(app)/apostas/loading.tsx` com `PageContainer width="reading"` (ganha o atributo de graça). O cabeçalho (`AppHeader`, `px-4 lg:px-8`, largura total) continua não alinhado à coluna: não foi pedido e mexer ali muda todas as telas. Sem deslocamento de layout: a regra é CSS puro, vale já no HTML do SSR e o rodapé é o último bloco da página (a troca de largura numa navegação client ou quando o streaming troca o `loading.tsx` pela página só re-quebra o texto do próprio rodapé). Se uma página tiver dois contêineres de larguras diferentes, vence o mais estreito (ordem das regras); hoje nenhuma tem. Custo do `:has()` no `body` com seletor de atributo: desprezível no tamanho destas páginas.

---

## Linha 27: login

### Como funciona hoje (o que não pode quebrar)
- `app/signin/page.tsx` (Server Component, `auth()` → logado vai pra `/jogos`; mapeia `?error=` → mensagem PT e passa pro wrapper).
- `app/signin/sign-in-methods.tsx` (client): checkbox 18+ + clickwrap dos Termos (ADR 0047; links **fora** do `<label>`, em nova aba); `canSubmit(accepted)` (`app/signin/can-submit.ts`) gateia os três métodos.
  - Google: `<form action={signInWithGoogle}>` (`app/signin/actions.ts:53`, `signIn("google", { redirectTo: "/jogos" })`). Sem JS vira POST nativo com 303 pro Google, liberado em `form-action` da CSP (`lib/security/csp.ts:84`).
  - Magic link: `<form action={sendMagicLink}>` com `<Input name="email">` (`actions.ts:21-51`: normaliza, rate-limit por IP/e-mail/global, `signIn("resend")`).
  - Passkey: `app/signin/passkey-signin-button.tsx`, **campo de e-mail próprio** (`:67-78`) + `signIn("passkey", { email, redirect: false, redirectTo: "/jogos" })` de `next-auth/webauthn`. O `getUserInfo` padrão do provider (`@auth/core/providers/webauthn.js:82-97`) acha o usuário pelo `email`: e-mail existente → `authenticate` com as credenciais dele (`allowCredentials`); e-mail novo → **`register`** (cria conta com passkey, um dos três caminhos de cadastro citados em `lib/db/queries/users.ts:188`); sem e-mail → `authenticate` sem lista (só passkey "descoberta"). Conferido em `next-auth@5.0.0-beta.31/webauthn.js`: o `signIn("passkey", { email, … })` cliente manda os parâmetros como query no `GET /api/auth/webauthn-options/passkey?email=…` e de novo no corpo do `POST /callback/passkey`; o `getUserInfo` lê `query.email` / `body.email` (`@auth/core@0.41.2`), e `inferWebAuthnOptions` decide authenticate/register. **Hoje o caminho "sem e-mail" não é alcançável na tela** (o botão sai desabilitado com `!email`), e continua assim.
- Testes: `app/signin/__tests__/sign-in-methods.test.tsx`, `app/signin/__tests__/can-submit.test.ts`, `__tests__/webauthn-wiring.test.ts`, `__tests__/auth.config.test.ts`, `lib/security/csp.test.tsx`, `__tests__/csp-coverage.test.ts`.

### Decisão: um campo de e-mail que serve aos dois (passkey e link)
Recomendado sobre "passkey como botão sem campo", porque sem e-mail o Auth.js só faz `authenticate` sem lista: some o caminho de **cadastro por passkey** (e-mail novo → `register`) e falha com credencial não descoberta (o registro usa o default do SimpleWebAuthn v9, `residentKey: "preferred"`, então nem toda chave é descoberta). Com o campo compartilhado, o comportamento das três cerimônias fica idêntico ao de hoje.

### Mudanças exatas
- `app/signin/sign-in-methods.tsx`:
  - Estado novo `const [email, setEmail] = useState("")` (sobe do botão de passkey).
  - Logo depois do bloco do checkbox (`:49-89`), quando `!accepted`: `<p id="signin-gate-hint" className="text-body-sm tracking-tight text-muted-foreground">Marque a caixa acima para entrar. O Palpiteiro é só para maiores de 18 anos.</p>`. Some quando marca (render condicional; o SSR inicial mostra a frase, porque `accepted` começa `false`). Os três botões ganham `aria-describedby={enabled ? undefined : "signin-gate-hint"}` (ajuda quem chega no botão pelo leitor de tela; botão desabilitado não recebe foco, então a frase visível é o que conta).
  - Botão do Google (`:91-100`): `<GoogleMark />` + texto **"Continuar com o Google"** (decisão 5). Classes: `variant="outline" className="w-full gap-2.5 pl-3 pr-3 text-label font-medium"` (guia do Google: 12px antes do logo, 10px entre logo e texto, 12px depois do texto; 14/20). Tamanho igual ao dos outros botões (o guia pede o Google pelo menos tão visível quanto outras opções de terceiros; aqui não há outra).
  - Divisor (`:104-110`): "ou" → "ou com seu e-mail".
  - Bloco de e-mail (substitui o `<PasskeySignInButton>` solto de `:102` e o `<Card>` de `:112-135`; o `Card` sai):
    ```tsx
    <form action={sendMagicLink} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-meta uppercase tracking-label text-muted-foreground">e-mail</span>
        <Input type="email" name="email" required value={email}
               onChange={(e) => setEmail(e.target.value)}
               autoComplete="username webauthn" placeholder="voce@exemplo.com" />
      </label>
      <Button type="submit" className="w-full" disabled={!enabled} …>Enviar link de acesso</Button>
      <PasskeySignInButton email={email} enabled={enabled} />   {/* type="button": não submete o form */}
      {errorMessage && <p className="text-body-sm text-destructive tracking-tight">{errorMessage}</p>}
    </form>
    ```
    `autoComplete="username webauthn"` é o que o campo de passkey usa hoje e o que o próprio provider declara (`formFields.email.autocomplete`); com `type="email"` o teclado do celular continua o de e-mail. Conferir no Chrome e no Safari que os e-mails salvos aparecem; se não, trocar por `"email"` (perde só a dica de autofill de passkey, que hoje não está ligada: não há `useBrowserAutofill`).
  - Texto de apoio (`:137-140`) fica: "Qualquer e-mail pode entrar. O link pode cair na pasta de spam no primeiro envio." + uma frase: "A passkey usa a biometria ou o PIN deste aparelho; cadastre uma no seu perfil depois de entrar."
  - Atualizar o comentário do topo (`:17-30`).
- `app/signin/passkey-signin-button.tsx`: props `{ email: string; enabled?: boolean }`; tirar o `useState` do e-mail e o `<label>/<Input>` (`:29`, `:67-78`), e o import de `Input`. Mantém `pending`, `error`, `disabled={pending || !email.trim() || !enabled}` e a mensagem de erro inline. **Uma mudança no `onClick` (revisão, R4):** mandar `email: email.trim().toLowerCase()`, a mesma normalização do `sendMagicLink` (`actions.ts:22-24`). O `getUserByEmail` do Drizzle adapter compara com `eq` (sensível a caixa) e o adapter grava o e-mail em minúsculas; sem normalizar, "Fulano@x.com" no campo agora compartilhado entra pelo link na conta certa e, pela passkey, cai no `register` e cria uma segunda conta. O `<div>` vira fragmento (o espaçamento vem do form).
- Novo `app/signin/google-mark.tsx`: Server-safe, sem `"use client"`. `<svg viewBox=… className="size-4.5" aria-hidden="true" focusable="false">` com os quatro paths oficiais do "G" (`#EA4335`, `#4285F4`, `#FBBC05`, `#34A853`), copiados do pacote de assets do Google, sem alterar forma nem cor, **só com atributos `fill`** (nenhum `style=`, nenhum `<style>`). **Tamanho por classe, não por atributo** (revisão, R3): a base do `Button` tem `[&_svg:not([class*='size-'])]:size-4` (`components/ui/button.tsx:7`), que reduziria o "G" a 16px por cima de `width="18"`; o guia proíbe mudar o tamanho do "G". `size-4.5` (18px) contém `size-` e escapa da regra; se o pacote oficial do botão web vier com outro tamanho, usar o dele. Embrulho: `<span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white">` **nos dois temas** (o guia manda o "G" colorido sobre fundo branco; no claro o `outline` já é branco, mas o `hover:bg-accent` do botão tira o branco de trás do "G"; no escuro é o círculo branco do botão escuro oficial). SVG inline não passa pela CSP (`img-src` nem entra; o `style-src` não importa porque não há `style`). As cores hex ficam só neste arquivo (exceção registrada na ADR do commit 1; não são tokens do app).
- `app/signin/page.tsx`: só o `Wordmark` (commit 2) e o `data-page-width="form"` (commit 3). O texto "Entre com sua conta Google, com uma passkey ou com um link por e-mail." fica.

### Testes
- `app/signin/__tests__/sign-in-methods.test.tsx`:
  - mock do `PasskeySignInButton` recebe `{ enabled, email }` e reflete `data-email`;
  - "Entrar com Google" → "Continuar com o Google";
  - **um campo só**: `(markup.match(/type="email"/g) ?? []).length === 1`, com `name="email"`;
  - o botão de passkey (mock) está **dentro** do `<form>` do magic link (índice entre `<form` e `</form>`) e não é `type="submit"`;
  - frase do bloqueio no estado inicial: contém "Marque a caixa acima para entrar." e `id="signin-gate-hint"`, e os botões têm `aria-describedby="signin-gate-hint"`;
  - o botão do Google tem `<svg` com `aria-hidden="true"` e os quatro fills oficiais;
  - mantidos: 3 desabilitados no estado inicial, clickwrap, links fora do `<label>`, mensagem de erro.
- Novo `app/signin/__tests__/passkey-signin-button.test.tsx` (mock de `next-auth/webauthn`): sem `email` (ou só espaços) o botão sai desabilitado; com `email` e `enabled`, habilitado; não renderiza `<input>`. Guarda de fonte: o `onClick` passa `email.trim().toLowerCase()` (sem harness de clique no repo, é o que dá pra travar).
- No mesmo teste do Google: o `<svg>` tem classe `size-4.5` (ou outra `size-*`) e nenhum `style=`.
- Sem mudança: `can-submit.test.ts`, `webauthn-wiring.test.ts`, `auth.config.test.ts`, testes de CSP.
- Manual, num preview da Vercel (o repo não tem harness de clique): (1) Google entra; (2) magic link chega e entra; (3) passkey com e-mail de conta que tem passkey entra; (4) passkey com e-mail novo cai no `register` como hoje; (5) Enter no campo envia o link (comportamento novo, ver riscos); (6) sem marcar a caixa, nada clica e a frase aparece. Passkey é por RP-id: precisa estar cadastrada **no host do preview**.

### Riscos
- **Enter envia o link.** Antes, Enter no campo da passkey não fazia nada (não havia form). Agora quem digita o e-mail pra passkey e aperta Enter recebe um link (custa um envio do Resend, dentro do rate-limit). Aceitável; a alternativa (passkey como submit padrão) faria quem usa link disparar a cerimônia de passkey. O gate do 18+ continua valendo no Enter: a submissão implícita usa o primeiro botão submit do form ("Enviar link de acesso"), que fica `disabled` enquanto a caixa não está marcada, e botão padrão desabilitado bloqueia a submissão implícita. Por isso o botão de envio tem de vir **antes** do de passkey no form (como no esboço) e o de passkey continua `type="button"`.
- As ações do servidor sempre terminam em `redirect` (`actions.ts`), então o reset automático de form do React 19 depois da action não chega a mexer no campo controlado.
- O teste de markup não cobre a cerimônia WebAuthn nem os redirects; a conferência manual no preview é obrigatória.
- `aria-describedby` em botão desabilitado ajuda pouco; o que resolve é a frase visível logo acima dos botões.

---

## Linha 25c: landing

### Hoje
`app/page.tsx` (force-static, metadata, JSON-LD, header próprio) + `app/landing-content.tsx` (eyebrow "palpite-first · IA + odds", h1 "Um palpite por jogo, com racional.", texto "motor de seleção de edge multi-mercado", CTA, e o aviso inline `:56-60`). Três avisos na tela: o inline, a linha 18+ do rodapé e o "não é casa de apostas" do rodapé. Nenhuma imagem; metade da tela vazia no desktop.

### Imagens de produto: ilustrações renderizadas em código (recomendado)
Três componentes de prévia, Server Components puros, que **compõem os primitivos reais** do app com dados fictícios fixos:
- Não envelhecem em silêncio: tokens, `ResultBadge`, `TeamAvatar`, `Card` e os pedaços do palpite público são os mesmos da tela; mudou o primitivo, mudou a prévia; mudou a assinatura, quebra o `typecheck`.
- Tema claro e escuro de graça (um print exigiria duas imagens por bloco).
- Zero bytes de imagem, `force-static` intacto, nada a liberar na CSP (`img-src 'self'` nem é usado) e **nada em `public/`**. Landmine evitada: o matcher do `middleware.ts:70` não exclui `public/`, então `/landing/x.png` tomaria 307 → `/signin` pra visitante sem sessão (o mesmo vale hoje pra `/flags/wc/*.svg`, que só aparece logado). Print em `public/` exigiria mudar o matcher, `__tests__/middleware-matcher.test.ts`, `lib/security/gated-routes.test.ts` e o lookahead de cache do `next.config.ts`.
- Alternativa rejeitada: prints PNG/WebP de um render local com dados semeados. Não há Playwright no repo nem banco de seed com sessão; o print envelhece a cada PR de UI sem nenhum teste acusar; dois temas; e o caminho `public/` cai no gate acima (um `import` estático via `next/image` iria pra `/_next/static/media`, fora do matcher, mas não resolve o envelhecimento).
- Por que não os componentes de página de verdade: `SlipCard` é local de `app/(app)/apostas/page.tsx` e o cartão do bolão é inline em `app/(app)/bolao/[id]/page.tsx`, ambos reescritos pelo PR 4; `PublicPalpite` traz os três avisos do `/p` embutidos (quebraria o "um aviso só"). Follow-up: quando o PR 4 extrair o cartão de aposta e o de bolão para `components/`, trocar as prévias por eles com dados fictícios.

### Arquivos e mudanças exatas
- `components/palpites/public-palpite.tsx`: **exportar** `Kicker`, `ConfidenceChip` e `ProbableScore` (hoje funções locais; sem mudança de comportamento). São firewall-safe por construção (palavra, nunca número de valor).
- Novos em `components/landing/` (sem `"use client"`, sem `auth`, sem DB, sem fetch):
  - `preview-data.ts`: os dados fictícios, num lugar só (decisão 2): dois times inventados, por exemplo "Coqueiros FC" × "Serra Azul" (sigla `COQ`/`SER`, `hue` fixo), monograma do `TeamAvatar` (sem `flagCode` e sem escudo: nada externo); veredito "Coqueiros leva num jogo de poucos gols"; placar provável **1–0**; confiança média; duas seleções em Suas apostas ("Coqueiros vence", "Menos de 2,5 gols"); três amigos no bolão ("Ana 1 × 0", "Beto 1 × 1", "Caio 0 × 2"), placar final **1 × 0**. (Corrigido na revisão: o rascunho tinha "poucos gols" com placar provável 2–1 e final 2 × 1, que somam 3 gols e derrubariam o "Menos de 2,5" da mesma história.)
  - `palpite-preview.tsx`: cartão no estilo do palpite público (`rounded-xl border border-palpite-border bg-palpite-soft/40`), times com `TeamAvatar`, `Kicker`, `ConfidenceChip`, veredito em `text-display-sm`, `ProbableScore`. Sem selo de resultado (nada "acertou" do app).
  - `apostas-preview.tsx`: `Card` com o jogo e as duas seleções, cada uma com `ResultBadge result="pending"` ("Em aberto"). **Sem odd, sem stake, sem vantagem** (decisão 3).
  - `bolao-preview.tsx`: `Card` com o placar final, a lista dos três amigos com `ResultBadge` won/lost (é o resultado dos amigos, não do app) e a linha "Ganhou: Ana" com o ícone `Trophy`. **Sem R$ e sem pote** (decisão 3).
  - `landing-figure.tsx`: moldura comum: `<figure>` com a prévia dentro de um `<div aria-hidden="true" inert>` (o leitor de tela não lê texto falso como conteúdo; React 19 aceita `inert` booleano), `<figcaption>` visível em `text-meta text-muted-foreground`: "Exemplo ilustrativo, com times fictícios." e um `sr-only` com a descrição do que a prévia mostra. O rótulo visível é o que impede a leitura de "registro de verdade" (ADR 0048 D4, nada de número ou resultado fabricado apresentado como real).
- `app/landing-content.tsx` (reescrito; continua síncrono pro `renderToStaticMarkup`):
  - Hero: sem eyebrow; `<h1>` (`text-display-lg lg:text-display-xl`) **"Palpites de futebol e o bolão da turma, num lugar só."** (decisão 13); parágrafo `text-body`: "Escolha o jogo e a IA crava um palpite com o porquê. Você anota suas apostas e o bolão com os amigos; depois do apito, o app confere o placar e faz a conta."; CTA `Entrar` (→ `/signin`) e "Como funciona →" (→ `/como-funciona`) como hoje. (Revisão, R6: o palpite é **sob demanda**, no "Analisar com IA" da página do jogo, com limite diário; "a IA lê cada jogo"/"pra cada jogo" prometeria um palpite pronto em todo jogo, o que a ADR 0048 D4 e o CDC art. 37 pedem para não afirmar.)
  - Três blocos (`<section aria-labelledby>`), `grid gap-8 lg:grid-cols-3`; cada um com título `text-display-sm`, uma ou duas frases e a figura:
    1. **Palpite da IA**: "No jogo que você escolher, a IA cruza forma, confrontos, desfalques e o modelo de placar e diz quem leva, o placar provável e por quê. É palpite, não recomendação de aposta."
    2. **Suas apostas**: "Marque o que você apostou e o app guarda tudo num lugar só, em unidades. Depois do jogo, ele confere sozinho: Acertou, Errou ou Devolvida. Só você vê."
    3. **Bolão**: "Anote o palpite de cada amigo, sem ninguém precisar de conta. No fim do jogo o app mostra quem acertou e, se vocês combinaram um valor, como fica a divisão." (revisão: o valor é opcional pela ADR 0054, que se apoia nisso para o enquadramento da LCP art. 50; a landing não deve sugerir que bolão é sempre a dinheiro) + `POOL_MONEY_NOTE` (`lib/view/friend-pool.ts:8`, single-source: "O Palpiteiro só anota as apostas e faz a conta. Não recebe, não guarda e não repassa dinheiro: o acerto é entre vocês."). É fato do produto (ADR 0054 D7), não aviso de responsabilidade.
  - **Sem aviso inline** (`:56-60` sai). O aviso da tela é o rodapé global, que já tem 18+, "Aposte com responsabilidade. Aposta não é investimento.", CVV 188, Jogadores Anônimos e "Palpiteiro é uma ferramenta de análise. Não é casa de apostas e não aceita dinheiro real." Conferido contra a ADR 0048: a D4 põe o 18+ "em toda página (footer global)", o "Aposta não é investimento" em "footer, Termos §4, disclaimers" e os avisos de risco na análise, no registro/histórico e no `/p`; a landing não está na lista. O `docs/ops/05-legal-compliance.md` §7 manda o 18+, a frase de jogo responsável e o "não é casa de apostas" no **footer global, toda página**, nada na landing. O Report 11 cita `landing-content.tsx:57` como uma das evidências do A5, junto do rodapé (`:34`) e dos Termos §4; os outros dois continuam. E o próprio Report 11 (§4, #432) chama a linha inline da landing de "redundância inofensiva". A ADR 0057 D6 deixou a landing para este PR com a regra "o §3 uma vez onde se registra ou lista aposta"; a landing não registra nem lista aposta, então não leva §3. Registrar na ADR do commit 1, citando que a evidência do A5 passa a ser rodapé + Termos. O que sai junto e não volta: "O dinheiro aqui é hipotético" (o rodapé diz "não aceita dinheiro real" e o bloco do bolão traz `POOL_MONEY_NOTE`).
  - Comentário do topo reescrito: firewall da landing = sem odd, EV, vantagem, stake, R$, %, número de desempenho, promessa ("ganhe", "lucro", "garantido") e nenhum nome ou link de casa.
- `app/page.tsx`:
  - `<main className="mx-auto w-full max-w-reading px-6">` → `<main><PageContainer width="content">…</PageContainer></main>` (largura content: os três blocos lado a lado no desktop; o rodapé alinha, commit 3).
  - Header: `px-6` → `px-4 lg:px-8` (igual ao `AppHeader`), `Wordmark` dentro de `<Link href="/">`, e à direita `ThemeToggle` + link "entrar" (`/signin`) com as mesmas classes do `AppHeader` anônimo (`components/app-shell.tsx:87-92`). Não importar o `AppHeader`: o módulo puxa `getSession` → `@/auth`, e o `__tests__/public-page-titles.test.ts` importa `app/page`.
  - Metadata (`:15-28`): `title.absolute` → **"Palpiteiro · palpites de futebol e bolão entre amigos"**; `description` → "Palpite da IA no jogo que você escolher, com o porquê. Anote suas apostas e o bolão da turma; o app confere o placar e faz a conta. Ferramenta de análise, não é casa de apostas."; `openGraph.title`/`description` iguais; `type: "website"` e `alternates.canonical: "/"` ficam. Sem "edge", sem "UM", sem "motor".
  - `export const dynamic = "force-static"` e o JSON-LD (`:34-49`, `:64-68`) **não mudam**.

### Testes
- `components/__tests__/landing-page.test.tsx` (reescrito, asserções estruturais como hoje):
  - renderiza sem lançar; um `<h1>`; CTA `href="/signin"`; `href="/como-funciona"`; nenhum link pra rota gateada (mantido);
  - três `<section>` com os títulos "Palpite da IA", "Suas apostas", "Bolão", cada uma com `<figure>`, `aria-hidden="true"` na prévia e o rótulo "Exemplo ilustrativo";
  - **um aviso só**: o corpo **não** contém "18+", "Não é casa de apostas" nem "Aposta não é investimento" (o rodapé carrega; travado em `site-footer.test.tsx`);
  - firewall: o texto (sem tags) não casa `/\bodds?\b|vantagem|\bedge\b|stake|R\$|%|\b\d+(,\d+)?u\b|lucro|garant|ganhe/i`; nenhum `<img` (nada externo); nenhum `"use client"` em `app/landing-content.tsx` e `components/landing/*` (lendo o fonte).
- `__tests__/public-page-titles.test.ts:34-38`: o `title.absolute` novo. Acrescentar: `description` e `openGraph.description` da landing não contêm "edge".
- `components/__tests__/no-bookmaker-copy.test.ts` e `design-scale-guard.test.ts` já varrem `components/landing/` (mono só com `tabular-nums` nos placares das prévias; nada de `text-[Npx]`).
- `__tests__/page-header-coverage.test.ts` ("em components/, só o PageHeader e o PageHeading do admin têm `<h1>`"): as prévias e a moldura em `components/landing/` não usam `<h1>`; o `<h1>` da landing fica em `app/landing-content.tsx`. Títulos dentro das prévias, se houver, em `<p>`/`<span>` (ficam sob `aria-hidden`).
- Firewall de "sob demanda": o texto da landing não casa `/cada jogo/i` (trava o R6).
- `pnpm build`: a rota `/` continua `○` (estática) na saída do build. JS do cliente: as prévias são Server Components (`TeamAvatar`, `ResultBadge`, `Card`, `Badge`, ícones lucide, e `Kicker`/`ConfidenceChip`/`ProbableScore` de `public-palpite.tsx`, que já roda no servidor no `/p`), então o First Load JS de `/` não pode crescer além do `ThemeToggle` de hoje; conferir na tabela do build. Os imports novos (`lib/view/friend-pool.ts`, `public-palpite.tsx`) só trazem tipos de `@/db/schema` e de `app/p/[id]/load-shared-palpite` (`import type`, apagados), nada de DB.

### Riscos
- A prévia pode divergir da tela real na **estrutura** (os primitivos acompanham, o arranjo não). Mitigação: o follow-up do PR 4 e a conferência visual a cada PR de UI das telas de origem.
- Times inventados podem soar artificiais; times reais na landing seriam uso de marca de clube em página de produto de apostas (decisão 2).
- Sem o aviso inline, quem não rola até o rodapé não vê o 18+ antes do CTA. A tela de login (próximo passo) tem o 18+ obrigatório; e é o desenho que a ADR 0048 D4 já previa.
- A issue pede "com print"; o plano entrega ilustração em código. Dizer isso no corpo do PR e na caixa 25 da issue (decisão 1), para o dono não ler como item esquecido.

---

## Linha 25d: Como funciona

### Hoje (`app/como-funciona/como-funciona-content.tsx`, 615 linhas, ~7.400px no celular)
Intro com "recomenda e acompanha", "edge", "PASS"; seções over/under do zero, "Como o app decide: edge, confiança e PASS" (com o exemplo ponta a ponta aberto), "Os outros mercados" (1X2, BTTS e dupla chance com exemplos abertos e o **"Temporariamente indisponível" fixo em `:303-306` e `:357-360`**, resto do #491; a cobertura de BTTS e dupla chance no Brasileirão e na Champions entrou no #522, `lib/odds/market-descriptor.ts`), "Como ler os números" (yield, win rate, pass rate), "O Palpite", glossário e jogo responsável. Não fala de Dixon-Coles, Suas apostas nem bolão. Números com ponto ("1.92", "0.5208", "+8pp").

### Contratos que não podem quebrar
- **Âncoras do glossário** (`components/help/glossary.ts`, renderizadas pela `GlossarySection` como `id`): alvo dos `HelpHint` (`components/help-hint.tsx:50`, `/como-funciona#<anchor>`), em uso hoje: `amostra-pequena`, `edge`, `leitura-modelo`, `lucro-total`, `odd-minima`, `overround`, `prob-implicita`, `recomendacao`, `yield` (como prop `anchor="…"`) e mais `prob-modelo`, `retorno-esperado`, `win-rate`, `pass-rate` (como `anchor: "…"` em objetos: `components/dashboard/kpi-cards.tsx:72-90`, `components/analysis-scenarios.tsx:235-279`; a lista do rascunho tinha esquecido esses quatro). Nenhum anchor muda; o teste `:96-101` (todo anchor do `GLOSSARY` vira `id`) já cobre todos.
- Ids de mercado (`mercado-over-under`, `mercado-1x2`, `mercado-btts`, `mercado-dupla-chance`) e `o-palpite`: ficam.
- `MIN_EDGE_PP` interpolado (nunca número fixo).
- O bloco "Jogo responsável" (`:562-612`): **texto mantido verbatim** (decisão 10); só ganha `id`.

### Estrutura nova (um bloco por conceito; o `ComoFuncionaContent` continua síncrono)
`app/como-funciona/page.tsx`: `PageContainer width="reading"` (commit 3); metadata (`:10-12`): título fica ("Como funciona · Palpiteiro", travado no teste de títulos); `description` → "Como o Palpiteiro funciona: o palpite da IA, o modelo de placar (Dixon-Coles), os mercados, a vantagem e o \"sem aposta\", Suas apostas e o bolão entre amigos. Com glossário." (sem "edge", "PASS", "stake").

`ComoFuncionaContent`:
1. `PageHeader` (`title="Como funciona"`, `description` uma frase: "Do palpite da IA ao bolão com os amigos, sem jargão. As contas ficam recolhidas em \"ver a conta\".").
2. **Índice** `<nav aria-label="Nesta página">` logo abaixo, lista de links (`text-body`, duas colunas a partir de `sm:`) gerada de uma constante `SECTIONS` (id + título) usada também pelos `<section>`, pra índice e seções nunca divergirem: `o-palpite` "Palpite da IA" · `leitura-do-jogo` "Como a IA lê o jogo" · `mercados` "Os mercados" · `como-o-app-decide` "Vantagem e sem aposta" · `suas-apostas` "Suas apostas" · `bolao` "Bolão" · `seus-numeros` "Seus números" · `glossario` "Glossário" · `jogo-responsavel` "Jogo responsável". Cada `<section>` com `scroll-mt-20` (cabeçalho fixo de 56px) e `aria-labelledby`.
3. Seções (cada uma: `h2` `text-display-sm`, 1 a 3 parágrafos curtos, links pro glossário com os `href="#…"` de hoje):
   - **Palpite da IA** (`o-palpite`): condensa `:457-551` em três parágrafos: o que é (quem leva, placar provável, porquê; tom de amigo; sai quando alguém pede a análise na página do jogo, "Analisar com IA", com limite por dia, sem dizer que todo jogo já tem palpite), o que não é (sem odd, vantagem, stake ou %; "é palpite, não recomendação de aposta"), como presta contas (Acertou/Errou depois do apito, "em aberto" até lá, "só por diversão" o que não dá pra conferir; "o palpite leu" com as fontes). Troca "aguardando placar" → "em aberto" e "O Palpite" → "Palpite da IA" (nome da ADR 0056, decisão 17 do PLAN-575).
   - **Como a IA lê o jogo** (`leitura-do-jogo`, novo; Dixon-Coles, ADR 0051/0052): "Antes da IA, o app calcula em código a chance de cada placar com o modelo Dixon-Coles: a força de ataque e de defesa de cada time, estimada nos jogos da liga dos últimos três anos, com mais peso para os recentes, e o mando de campo. Daí saem as chances de vitória, empate, total de gols e ambas marcam. Quando falta histórico (time que acabou de subir, poucos jogos na Champions) e na Copa do Mundo, o app usa um modelo mais simples, a partir da tabela. Perto do jogo, a análise ajusta essa leitura com o que o modelo não vê: desfalques, escalação provável e notícias." + link pra `#leitura-modelo`. **Sem número do backtest e sem "acerta mais"** (ADR 0048 D4: nada de desempenho em página pública).
   - **Os mercados** (`mercados`): uma frase de abertura + quatro sub-blocos `h3` com os ids de hoje: **Total de gols** (`mercado-over-under`: "Mais de 2,5" = 3 gols ou mais; "Menos de 2,5" = 0, 1 ou 2; a linha 2,5 nunca empata), **Resultado (1X2)** (`mercado-1x2`), **Ambas marcam** (`mercado-btts`), **Dupla chance** (`mercado-dupla-chance`). Cada um com 1–2 frases e o exemplo numérico de hoje dentro de `<details>` "ver a conta" (abaixo). **Sai o "Temporariamente indisponível"** dos dois. No lugar, uma frase genérica no fim da seção, que não depende de lista de ligas: "Nem todo jogo tem odds de todos os mercados; quando falta, o mercado não aparece na análise daquele jogo." (Ligas ativas vêm do banco, ADR 0050; a cobertura por liga mora em `coveredLeagues` e pode mudar sem deploy desta página. Uma frase fixa por liga voltaria a envelhecer como a do #491.)
   - **Vantagem e sem aposta** (`como-o-app-decide`): a chance do modelo contra a chance do mercado (já sem a margem embutida na odd); a diferença é a **vantagem**, em pontos; só recomenda com pelo menos `{MIN_EDGE_PP} pontos`; senão, **sem aposta**, que não é erro; quando recomenda, de 1 a 3 unidades conforme a força do sinal. `<details>` "ver a conta" com o exemplo ponta a ponta do total de gols (hoje `:117-157`).
   - **Suas apostas** (`suas-apostas`, novo; ADR 0053): "Na página do jogo, toque nas seleções que você apostou, informe a odd e, se quiser, quanto apostou em unidades, e registre. Na hora, o app mostra a chance que o modelo dá pra cada seleção e a odd justa; com as odds completas do mercado, também a vantagem. Depois do apito ele confere sozinho: Acertou, Errou ou Devolvida. É privado: só você vê. O app não aposta por você e não tem ligação com casa de apostas." + link pra `#app-nao-aposta` e `#stake-unidade`.
   - **Bolão** (`bolao`, novo; ADR 0054): "Crie um bolão pra um jogo e anote a aposta de cada amigo (placar exato, resultado, dupla chance, ambas marcam ou total de gols), sem ninguém precisar de conta. No fim, o app confere com as mesmas regras de Suas apostas, usando o placar do jogo ou o que vocês lançarem, e mostra quem ganhou e quanto cada um leva do pote, se vocês combinaram um valor." + `POOL_MONEY_NOTE` (mesma constante da landing). (Revisão, R7: sai "As apostas fecham no apito inicial": o #580, já decidido pelo dono em 2026-10-15, muda o fechamento para 15 minutos de jogo; a frase envelheceria numa página pública como o "Temporariamente indisponível". A tela do bolão diz quando fecha.)
   - **Seus números** (`seus-numeros`, hoje "Como ler os números", `:365-451`): **retorno** (lucro ÷ total apostado), **taxa de acerto**, **jogos sem aposta**, **lucro total** e **bankroll** em unidades de dinheiro hipotético, **amostra pequena** (menos de 20 apostas); separados por mercado. Só definição, nenhum número de desempenho; fecha com "Resultado passado não garante resultado futuro." (ADR 0048 D4). O "pass rate entre 30% e 60% é saudável" sai do corpo (fica no glossário, `#pass-rate`).
   - **Glossário** (`glossario`): como hoje (`GlossarySection`), texto de apoio "toque pra expandir · o significado de cada termo do app".
   - **Jogo responsável** (`jogo-responsavel`): `:562-612` verbatim.
4. **"ver a conta"**: elemento nativo `<details>`/`<summary>` (sem JS, sem `"use client"`, acessível por teclado, e o conteúdo **continua no markup**, então os números seguem testáveis com `renderToStaticMarkup`). Um componente local `VerAConta` no próprio arquivo: `<details className="group mt-4 rounded-xl border border-border bg-surface-2">` + `<summary className="cursor-pointer list-none px-4 py-3 text-body-sm font-medium [&::-webkit-details-marker]:hidden …">` (o `list-none` não tira o marcador no Safari) com `ChevronRight` girando em `group-open:rotate-90` + o `<ul>` de hoje dentro. **Quatro** no total (o rascunho dizia cinco e listava quatro): total de gols ponta a ponta (na seção de vantagem), 1X2, ambas marcam e dupla chance (na seção de mercados; o sub-bloco Total de gols remete ao exemplo da vantagem, sem duplicar).
5. **Números e vocabulário** nos exemplos (ADR 0056 + vírgula decimal do PR 1, que deixou `/como-funciona` pra cá): "1.92" → "1,92", "0.5208" → "0,5208", "1.0417" → "1,0417", "+8pp" → "+8 pontos", "+0.1136 ≈ +11%" → "+0,1136 ≈ +11%"; 1X2 "mandante 2,10 / empate 3,40 / visitante 3,60", "1,0481", "+6,57 pontos", "+0,092 ≈ +9%"; ambas marcam "sim 1,80 / não 2,00", "+7,37 pontos", "+0,08 ≈ +8%"; dupla chance "1,25 / 2,00 / 1,30", "2,0692", "+1,68 pontos". "over/under" → "mais de/menos de", "edge" → "vantagem", "PASS" → "sem aposta", "yield" → "retorno", "win rate" → "taxa de acerto", "pass rate" → "jogos sem aposta", "pp" → "pontos", "1X2" só como sufixo do nome "Resultado (1X2)". Os links continuam apontando pros anchors de hoje (`#edge`, `#yield`, `#recomendacao`…).

### Glossário (`components/help/glossary.ts`), o que falta da ADR 0056
O corpo das entradas já fala português (PLAN-575, 16e). Sobra jargão interno em página pública:
- `:103` (`mercado`): "Tier 1: … Tier 2: …" → "Os mercados do app: total de gols, resultado (1X2), ambas marcam e dupla chance."
- `:197` (`leitura-modelo`): "ajustada pelos julgamentos do JEV perto do jogo" → "ajustada pela análise perto do jogo (desfalques, escalação, notícias)"; "Sem Claude" → "sem a IA".
- `:237` (`stake-confianca`): tirar "As bandas são determinísticas (ADR 0019)".
- `:244` (`liquidacao`): "Acertou (won), Errou (lost) ou Anulada (void)" → "Acertou, Errou, Devolvida ou Anulada"; "roda via cron" → "roda algumas horas depois do apito". Term "liquidação / settlement" → "liquidação (conferência)".
- `:131` (`odd-decimal`): "1.92"/"0.92u" → "1,92"/"0,92u"; `:210` (`retorno-esperado`): "1.92 → +0.1136" → "1,92 → +0,1136".
- Termos (`term`) com o apelido em inglês entre parênteses ("retorno (yield)", "taxa de acerto (win rate)", "vantagem (edge)", "devolvida (push)") **ficam** (decisão 11): é o que um iniciante vindo de outro app procura, e o termo lidera com a palavra da tela.
- Entradas novas (anchors novos, `group` coerente): `odd-justa` ("odd justa": 100 ÷ chance do modelo; o que o modelo acha que a odd deveria ser), `combinada` ("combinada": duas ou mais seleções numa aposta só; só acerta se todas acertarem), `pote` ("pote do bolão": valor por pessoa × apostas; quem acerta divide; o app não mexe em dinheiro). Nenhum anchor novo pode coincidir com id de seção (teste abaixo).

### Testes
- `components/__tests__/como-funciona-page.test.tsx` (reescrito onde fixa texto):
  - headings novos: "Como funciona", "Palpite da IA", "Como a IA lê o jogo", "Os mercados", "Vantagem e sem aposta", "Suas apostas", "Bolão", "Seus números", "Glossário", "Jogo responsável";
  - índice: todo `href="#x"` dentro do `<nav aria-label="Nesta página">` tem `id="x"` no markup;
  - ids de mercado mantidos (`mercado-over-under`, `mercado-1x2`, `mercado-btts`, `mercado-dupla-chance`) e `o-palpite`;
  - **"Temporariamente indisponível" não aparece** (o teste do #491, `:76-84`, inverte);
  - menciona "Dixon-Coles", e as seções `suas-apostas` e `bolao` existem; o bolão contém `POOL_MONEY_NOTE`;
  - "ver a conta": exatamente 4 `<details>`, todo `<summary>` com "ver a conta"; nenhum `open` no markup;
  - bolão sem horário de fechamento: o corpo não contém "apito inicial" (R7);
  - exemplos numéricos com os valores novos (lista acima), inclusive `${MIN_EDGE_PP} pontos`;
  - **vocabulário**: no markup **até `id="glossario"`** (o glossário renderiza os termos com o apelido em inglês e é cortado), sem tags, nenhum `/\bPASS\b|\byield\b|win rate|pass rate|\d+pp\b|\bover\b|\bunder\b|\bedge\b/i` e nenhum "Tier";
  - sem número de desempenho: nenhum `/taxa de acerto de \d|\d+% de acerto/`;
  - jogo responsável mantido (`:86-94` como está) e o contrato de anchors do glossário (`:96-101`) mantido;
  - **ids de seção ∩ anchors do glossário = ∅** (`SECTIONS` exportada ou lida do markup).
- `components/help/__tests__/glossary.test.ts`: os casos de hoje continuam; acrescentar: nenhum `meaning` contém "ADR", "JEV", "Tier", "cron" ou "(won)"; as três entradas novas existem.
- `components/__tests__/help-hint.test.tsx`: sem mudança (anchors iguais).
- `__tests__/public-page-titles.test.ts`: título de `/como-funciona` igual; acrescentar que a `description` não contém "edge" nem "PASS".

### Riscos
- Reescrita grande de texto: o dono revisa a cópia no PR (a página é "real porém revisável").
- `<details>` fechado esconde o conteúdo do Ctrl+F em alguns navegadores (o Chrome abre sozinho ao achar; Safari não). Aceitável para contas de exemplo.
- Página logada e anônima usam o mesmo conteúdo; o `AppShell` continua lendo a sessão (página dinâmica), sem mudança.

---

## Critério de saída (conferência visual e funcional)
- `pnpm test && pnpm lint && pnpm typecheck && pnpm build` verdes; no build, `/` segue `○` estática e `/signin`, `/como-funciona` como hoje.
- 390px e 1440px, claro e escuro: landing (três blocos, sem rolagem horizontal, prévias legíveis no escuro, rótulo "Exemplo ilustrativo"), login (um campo, frase do bloqueio some ao marcar, "G" colorido; no escuro dentro do círculo branco), como-funciona (índice leva a cada seção abaixo do cabeçalho fixo, "ver a conta" abre e fecha por teclado), `/termos`, `/privacidade`, `/jogos`, `/apostas`, um jogo.
- Rodapé: x do texto do rodapé = x do conteúdo em `/` (content), `/jogos` (content), `/apostas` e `/como-funciona` (reading), `/signin` (form), `/termos` (reading). Medir no DevTools em 390, 800, 1024 e 1440. Em 390px, `/signin` sem rolagem horizontal (`document.documentElement.scrollWidth === 390`). As regras do `:has()` presentes no CSS do build.
- Botão do Google: "G" medindo 18px no DevTools (não 16), sobre branco nos dois temas e no hover.
- Cabeçalho logado, landing e login sem "edge multi-mercado" em nenhuma largura (o sufixo do logado só aparecia em `2xl`: conferir em 1600px).
- Logins no preview: Google, magic link, passkey (autenticar e cadastrar com e-mail novo), conforme a seção da linha 27.
- `grep -rn "edge multi-mercado\|Temporariamente indisponível" app components` vazio.
- Issue #579: marcar as caixas 25 e 27.

## Decisões (resolvidas na revisão, pelo padrão do dono: aceitar o recomendado salvo problema concreto)
1. **Imagens de produto:** ✅ ilustrações renderizadas em código com primitivos reais. Conferido: prints em `public/` tomariam 307 → `/signin` sem sessão (`middleware.ts:70` não exclui `public/`; `__tests__/middleware-matcher.test.ts` trava o matcher). A issue diz "print": registrar a troca no PR.
2. **Times nas ilustrações:** ✅ fictícios, com monograma (sem `flagCode`, então o `TeamAvatar` não emite `<img>`).
3. **Números nas ilustrações:** ✅ nenhuma odd, stake, vantagem, R$ ou pote (ADR 0048 D4, ADR 0056 item 4). Placares e o selo dos amigos no bolão ficam, sob "Exemplo ilustrativo".
4. **Aviso na landing:** ✅ só o rodapé global. Base conferida: ADR 0048 D4 (18+ e "aposta não é investimento" no footer), `docs/ops/05-legal-compliance.md` §7 (footer em toda página), Report 11 §4 ("redundância inofensiva"), ADR 0057 D6 (§3 só onde se registra/lista aposta). Trava nova: `site-footer.test.tsx`.
5. **Texto do botão do Google:** ✅ "Continuar com o Google" ("Continue with Google" é uma das três frases do guia; localizar é permitido).
6. **Cores e fonte do botão do Google:** ✅ `outline` com tokens do app e Geist. O guia especifica Google Sans e as cores, mas não proíbe outra fonte; o que ele trava (e o plano cumpre, com as correções R3) é o "G" oficial, colorido, no tamanho do pacote e sobre fundo branco, o texto deixando claro que é login com a conta Google, e o botão Google pelo menos tão visível quanto outro login de terceiro.
7. **Passkey:** ✅ campo de e-mail compartilhado, com o e-mail normalizado no clique (R4).
8. **Alinhamento do rodapé:** ✅ `data-page-width` + `:has()`, com as regras corrigidas (R1, R2).
9. **ADR:** ✅ uma ADR curta nova, **próximo número livre no merge** (hoje 0058; a do #580 pode pegar antes). Conferir `ls docs/decisions` no rebase e renumerar os links do `DESIGN.md` junto.
10. **Jogo responsável em `/como-funciona`:** ✅ mantido verbatim; nada cortado.
11. **Apelidos em inglês no termo do glossário:** ✅ mantidos no `term`; corpo sem jargão.
12. **Link "entrar" no cabeçalho da landing:** ✅ sim (o logado nunca vê a landing: o middleware manda `/` → `/jogos`).
13. **Título da landing:** ✅ "Palpites de futebol e o bolão da turma, num lugar só."

## Arquivos que este PR toca
- Marca: `components/wordmark.tsx`, `components/app-shell.tsx`, `app/signin/page.tsx`, `app/page.tsx`.
- Rodapé: `components/site-footer.tsx`, `components/page-container.tsx`, `app/globals.css`, `app/termos/page.tsx` e `app/privacidade/page.tsx` (só contêiner e cabeçalho), `app/como-funciona/page.tsx`.
- Login: `app/signin/sign-in-methods.tsx`, `app/signin/passkey-signin-button.tsx`, `app/signin/google-mark.tsx` (novo).
- Landing: `app/page.tsx`, `app/landing-content.tsx`, `components/landing/{preview-data.ts,palpite-preview.tsx,apostas-preview.tsx,bolao-preview.tsx,landing-figure.tsx}` (novos), `components/palpites/public-palpite.tsx` (só `export`).
- Como funciona: `app/como-funciona/como-funciona-content.tsx`, `app/como-funciona/page.tsx`, `components/help/glossary.ts`.
- Docs: ADR nova, `DESIGN.md` (rodapé que segue a coluna; `PageContainer` também nas públicas; marca sem sufixo; ilustrações de produto; exceção do "G").
- Testes: `components/__tests__/{landing-page,como-funciona-page,site-footer(novo)}.test.tsx`, `app/signin/__tests__/{sign-in-methods,passkey-signin-button(novo)}.test.tsx`, `components/help/__tests__/glossary.test.ts`, `__tests__/public-page-titles.test.ts`.
- **Não toca:** `middleware.ts`, `next.config.ts`, `lib/security/csp.ts`, `auth.ts`, `auth.config.ts`, `app/signin/actions.ts`, `app/signin/can-submit.ts`, `lib/ai/**`, `public/`, texto de `/termos` e `/privacidade`, telas do PR 3 e do PR 4.

## Colisões com o trabalho em paralelo
- PR 3 (#576, árvore atual): edita `DESIGN.md`, `app/(app)/como-usar/como-usar-content.tsx` e `__tests__/page-header-coverage.test.ts`; este PR edita `DESIGN.md` (seção diferente) e nenhum dos outros dois. Ocupa a ADR 0057.
- PR 4 (#577, `docs/plans/PLAN-577.md`): pelo plano atual **não** mexe em `components/page-container.tsx`, `app/globals.css` nem `components/help/glossary.ts`, e não cria ADR; cria `app/(app)/apostas/loading.tsx` com `PageContainer width="reading"` e troca "lucro total" por "saldo" nos `HelpHint` do desempenho (`kpi-cards.tsx`, anchor `lucro-total` intacto). Se o plano dele mudar, quem entrar depois faz rebase; o `data-page-width` faz o rodapé acompanhar qualquer largura que o PR 4 escolher.
- #580 (ao vivo, ADR planejada): muda o fechamento do bolão para 15 minutos de jogo e libera análise/Suas apostas ao vivo. Por isso este PR não escreve horário de fechamento em `/como-funciona` nem na landing (R7). Se o #580 entrar antes, conferir que nenhuma frase de Suas apostas/bolão/Palpite da IA diz "antes do jogo" ou "até o apito".
- O `docs/plans/PLAN-577.md` (PR 4) troca "lucro total" por **"saldo"** no desempenho e põe "Resultado passado não garante resultado futuro." no resumo. Se o PR 4 entrar antes, "Seus números" e o termo do glossário `lucro-total` (anchor fica) seguem a palavra "saldo"; se entrar depois, o PR 4 ajusta os dois.
- Follow-up para depois do PR 4: trocar as prévias de Suas apostas e bolão da landing pelos cartões que o PR 4 extrair para `components/`.

## Revisão do plano

Revisão adversarial de 2026-10-15, conferida no código (`2f050fd` + branch do #576), no `node_modules` (`next-auth@5.0.0-beta.31`, `@auth/core@0.41.2`, `@auth/drizzle-adapter`, `tailwindcss@4.3.0`), no CSS do último build local (`.next/static/css`) e no guia de marca do Google (developers.google.com/identity/branding-guidelines). As correções já estão no corpo; aqui o registro.

**Erros corrigidos**
- **R1. Variáveis de largura não existem em runtime.** O `@theme` de `app/globals.css` é `inline`: `max-w-reading` compila para `max-width:640px` e o `:root` do build não tem `--container-reading` nem `--container-form` (só aparece `--container-content`, porque o nome é citado em docs que o Tailwind varre). Um `var(--container-reading)` sem fallback poderia virar `max-width` inválido e o rodapé ficaria em `content` sem nenhum teste acusar. Agora: `var(--container-…, <px>)` + guarda de fonte + conferência no CSS do build.
- **R2. A conta do `form` com `content-box` estourava no celular.** Com `w-full` + `content-box`, a largura de conteúdo ia a 380 e o padding somava 40: caixa de 420px numa tela de 390, rolagem horizontal no `/signin`. Trocado por `border-box` com `max-width: calc(380px + 2.5rem)` e `+ 4rem` a partir de `lg`; conferido em 390, 800, 1024 e 1440.
- **R3. O "G" do Google sairia com 16px.** A base do `Button` força `size-4` em todo `svg` sem classe `size-*` (`components/ui/button.tsx:7`), por cima de `width="18"`; o guia proíbe mudar o tamanho do "G". Agora `className="size-4.5"` no `svg`. E o círculo branco vale nos dois temas: o `hover:bg-accent` do `outline` tiraria o branco de trás do "G" no tema claro.
- **R4. E-mail da passkey sem normalização.** O `getUserByEmail` do Drizzle adapter usa `eq` (sensível a caixa); o magic link normaliza (`trim().toLowerCase()`), a passkey não. Com um campo só para os dois, o mesmo texto levaria a contas diferentes (passkey → `register` de uma conta nova). O clique da passkey passa a normalizar igual.
- **R5. Lista de anchors incompleta.** Faltavam `prob-modelo`, `retorno-esperado`, `win-rate` e `pass-rate` (usados como `anchor: "…"` em `kpi-cards.tsx` e `analysis-scenarios.tsx`). O contrato não muda (nenhum anchor sai), e o teste existente cobre o `GLOSSARY` inteiro.
- **R6. Copy prometia palpite em todo jogo.** O palpite é sob demanda ("Analisar com IA", limite diário). "A IA lê cada jogo", "Pra cada jogo" e "Palpite da IA pra cada jogo" (metadata) viraram "o jogo que você escolher"; `/como-funciona` diz como se pede. Teste: a landing não casa `/cada jogo/i`.
- **R7. Horário do bolão ia envelhecer.** "As apostas fecham no apito inicial" sai de `/como-funciona`: o #580 (decidido pelo dono hoje) fecha aos 15 minutos de jogo.
- **Dados fictícios incoerentes:** "poucos gols" com placar provável 2–1 e final 2 × 1 (3 gols) contra a aposta "Menos de 2,5". Agora 1–0 e 1 × 0, Ana 1 × 0.
- **Bolão a dinheiro:** "como fica a divisão" virou "se vocês combinaram um valor, como fica a divisão" (o valor é opcional na ADR 0054, e é parte do enquadramento da LCP art. 50).
- **Contagem de "ver a conta":** quatro, não cinco; teste com "exatamente 4". `summary` com `[&::-webkit-details-marker]:hidden` para o Safari.
- **Colisões:** o PLAN-577 não toca `page-container.tsx`, `globals.css` nem `glossary.ts` e não cria ADR (o rascunho dizia que podia); o #580 entra na lista. Numeração da ADR: próximo livre no merge.

**Conferido e mantido**
- Passkey com campo compartilhado: o `signIn("passkey", { email })` de `next-auth/webauthn` manda o e-mail como query no `webauthn-options` e no corpo do callback; o `getUserInfo` padrão o lê dos dois; `inferWebAuthnOptions` mantém e-mail existente → `authenticate` com a lista do usuário e e-mail novo → `register`. O cadastro por passkey continua. O fluxo "descoberto" sem e-mail nunca foi alcançável na tela (botão desabilitado com `!email`) e continua assim.
- Gate do 18+: `canSubmit` e o checkbox não mudam; Enter no campo não fura o gate (o botão padrão do form está `disabled`, e isso bloqueia a submissão implícita), desde que o botão de envio venha antes do de passkey.
- CSP: SVG inline não passa por `img-src`; sem `style=` no SVG. O `style` inline do `TeamAvatar` nas prévias já é aceito (`style-src 'unsafe-inline'`, `lib/security/csp.ts:71`).
- Landmine de `public/`: confirmado (`middleware.ts:70`; o teste do matcher trava).
- Landing: `force-static` não muda; prévias são Server Components, sem JS novo no cliente; nenhum `<img>` (monograma sem `flagCode`); o `<h1>` fica fora de `components/` (guarda do `page-header-coverage.test.ts`).
- Aviso da landing: tirar a linha inline está dentro do que ADR 0048 D4, o `05-legal-compliance.md` §7 e o Report 11 (§4, "redundância inofensiva") pedem; o rodapé carrega 18+, "Aposte com responsabilidade. Aposta não é investimento.", CVV 188, Jogadores Anônimos e "não é casa de apostas", agora travados pelo `site-footer.test.tsx` novo (hoje nenhum teste trava o rodapé).
- Dixon-Coles (ADR 0051/0052): 3 anos, peso maior para jogos recentes (ξ por dia), mando e queda para o heurístico da tabela batem com o texto; acrescentada a Copa do Mundo, que sempre usa o heurístico.
- Cobertura de BTTS e dupla chance (`lib/odds/market-descriptor.ts:169,192`: Copa, Brasileirão e Champions; não Premier League nem La Liga): a frase genérica "nem todo jogo tem odds de todos os mercados" está certa.

**Riscos que ficam**
- O botão do Google usa Geist e os tokens do app, não Google Sans e os hex do guia (decisão 6). O guia especifica, mas não proíbe; se o Google pedir verificação de marca do app OAuth, trocar só esse botão.
- Ilustração em código no lugar de "print": diverge da letra da issue (ver decisão 1). O arranjo das prévias pode divergir das telas reais até o follow-up do PR 4.
- A cerimônia WebAuthn, os redirects e o alinhamento do rodapé não têm teste automático: a conferência manual no preview (Google, link, passkey autenticar e cadastrar, rodapé em 390/800/1024/1440) é obrigatória antes do merge.
- Quem não rola até o rodapé não vê o 18+ antes do CTA "Entrar"; o checkbox obrigatório do `/signin` cobre o momento do cadastro.
