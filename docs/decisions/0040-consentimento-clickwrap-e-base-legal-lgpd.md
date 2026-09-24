# ADR 0040 — Aceite explícito (clickwrap) dos Termos, Política informada, e base legal por finalidade (LGPD)

## Status

Accepted (2026-09-24). Decisão de revisão legal delegada pelo dono (report
[11](../reports/11-revisao-legal.md)). Substitui o default "aceite implícito" adotado no
PR #461 (docs/ops/05 §Decisões abertas; Report 09 §3). Fecha a issue #433. Implementado
no mesmo branch deste ADR (`app/signin/sign-in-methods.tsx`, `/termos`, `/privacidade`).

## Contexto

- Hoje (`origin/main` antes deste ADR): um checkbox obrigatório "Declaro ter 18 anos ou
  mais." gateia os 3 métodos de login (`app/signin/sign-in-methods.tsx:48-65`) e, abaixo,
  "Ao entrar, você concorda com os Termos de Uso e a Política de Privacidade" (`:66-86`) —
  aceite **implícito** (sign-in-wrap). `users.accepted_terms_at` é carimbado no
  `events.createUser` (`auth.ts`, `lib/db/queries/users.ts:174`).
- A `/privacidade` declarava como base legal "execução do serviço … **e** no seu
  consentimento ao criar a conta" — misturando duas bases.
- O checkbox já existe e já é obrigatório: tornar o aceite explícito custa **zero atrito
  adicional** (mesmo clique).

### Leitura legal

- Termos de Uso são **contrato de adesão**. Aceite explícito (clickwrap) é a forma mais
  robusta de provar manifestação de vontade e de tornar oponíveis a limitação de
  responsabilidade, a cláusula de não-garantia e as regras de conduta. Sign-in-wrap é
  aceito, mas é a forma mais contestável. *(princípio geral de formação de contrato — CC
  arts. 107 e 425 — não verificado — conferir depois)*
- Política de Privacidade **não é contrato**: é o cumprimento do dever de informação do
  art. 9º da LGPD (finalidade, forma e duração, identificação e contato do controlador,
  compartilhamento, responsabilidades, direitos do art. 18). *(verificado na fonte)* Pedir
  que o titular "aceite" a Política sugere que a base é consentimento — o anti-padrão.
- Consentimento como base (art. 7º, I) exigiria manifestação livre, informada e
  inequívoca pra finalidade determinada (art. 5º, XII), revogável a qualquer tempo (art.
  8º, § 5º), e autorizações genéricas são nulas (art. 8º, § 4º). *(não verificado — conferir
  depois)* Revogar o "consentimento" de uma conta cujo único propósito é usar o serviço
  equivale a encerrar o contrato — ou seja, a base real é o **art. 7º, V** (execução de
  contrato a pedido do titular). *(inciso V: verificado indiretamente pela remissão do art.
  33, IX; texto do art. 7º não conferido)*
- Segurança/antiabuso/controle de custo/prova do aceite não são "necessários ao contrato"
  em sentido estrito → **art. 7º, IX** (legítimo interesse), com o teste do art. 10
  (finalidade legítima, situação concreta, mínimo necessário, transparência) e direito de
  oposição (art. 18, § 2º). *(não verificado — conferir depois)*

## Decisão

**1. Clickwrap explícito dos Termos, no MESMO checkbox do 18+.** Texto do label:
"Declaro ter 18 anos ou mais e aceito os Termos de Uso." Links pros Termos e pra Política
logo abaixo ("Leia os Termos de Uso e a Política de Privacidade, que explica como
tratamos seus dados."), **fora** do `<label>` (abrir o link não marca a caixa) e em nova
aba (não perde o estado). Não se cria um segundo checkbox: 18+ e Termos são uma única
declaração de quem pode e aceita usar o serviço.

**2. A Política é informada, não aceita.** Nenhuma frase pede "aceite" ou "concordância"
com a Política. A `/privacidade` declara explicitamente que **não** usamos consentimento
como base do serviço.

**3. Base legal por finalidade (texto da `/privacidade` §3):**

| Finalidade | Base |
|---|---|
| Conta, análises/palpites/apostas registradas, compartilhamento a pedido | Art. 7º, V — execução de contrato |
| Segurança, antiabuso (limite por IP/e-mail/usuário), monitoramento de erros, controle de custo, prova do aceite | Art. 7º, IX — legítimo interesse (art. 10), com direito de oposição |
| Transferência internacional (Vercel, Neon, Resend, Anthropic, OpenAI, Upstash, Sentry — EUA) | Art. 33, IX c/c art. 7º, V *(verificado na fonte)* |

Consentimento (art. 7º, I) fica **reservado** pra qualquer tratamento futuro que não seja
necessário ao serviço (ex.: analytics de produto não essencial, newsletter) — aí, sim, com
opt-in separado, desmarcado por padrão e revogável.

**4. Prova e versão do aceite.** `accepted_terms_at` + a constante `LAST_UPDATED`
forward-only de `/termos` (histórico do repositório = qual versão vigia no instante). Sem
coluna de versão agora.

**5. Contas antigas e a versão de 2026-09-24.** A revisão desta data **não reduz direitos**
do usuário (acrescenta foro no domicílio dele, ressalva de direitos irrenunciáveis,
não-vínculo com casas, prazos de resposta) → **não** exige novo aceite; como o checkbox
gateia **todo** login (não só o cadastro), quem voltar ao app já clica o texto novo.
**Regra pra frente:** mudança que **reduza** direitos do usuário exige novo aceite antes
de continuar (compromisso escrito nos Termos §12). Quando a primeira acontecer, implementar
`users.terms_version_accepted` + interstitial no layout autenticado (esforço S-M).

**6. Follow-up pequeno (não neste branch):** hoje o carimbo só acontece no `createUser`;
usuários pré-#282 têm `accepted_terms_at = NULL` mesmo tendo clicado o checkbox em logins
posteriores. Carimbar no `events.signIn` quando ainda nulo (`markTermsAcceptedIfNull`)
fecha a lacuna de prova. Risco atual aceito (poucos usuários, todos conhecidos do dono).

**7. Identificação do controlador (art. 9º, III-IV).** Fonte única em
`lib/legal/controller.ts` (`CONTROLLER_LEGAL_NAME`, `LEGAL_CONTACT_EMAIL`,
`DATA_REQUEST_RESPONSE_DAYS`). Com o nome `null`, as páginas identificam o controlador como
"a pessoa física que mantém o Palpiteiro como projeto pessoal, sem empresa constituída" e
oferecem identificação completa pelo canal. **Isso é conformidade parcial com o art. 9º,
III** — preencher o nome é ato do dono (report 11, ações do dono).

**8. Encarregado dispensado.** O controlador é pessoa natural que trata dados assumindo
obrigações de controlador → agente de tratamento de pequeno porte (Res. CD/ANPD nº 2/2022,
art. 2º, I, que inclui "pessoas naturais"). Não há tratamento de alto risco: o art. 4º exige
**um critério geral** (larga escala **ou** afetar significativamente direitos) **e** um
específico; temos só um específico (IA = tecnologia emergente) — a IA analisa partidas,
não pessoas, e a escala é de amigos. Logo, dispensa de encarregado (art. 11) com canal de
comunicação obrigatório = `contato@palpiteiro.live`, linkado no footer global, nas
páginas legais e no `/perfil`. Prazo em dobro do art. 14 **não** é usado: adotamos 15 dias
(art. 19, II) pra tudo. *(Res. 2/2022 arts. 2º, 3º, 4º, 11, 14: verificados em fonte
secundária — normaslegais.com.br —, não no portal da ANPD)* **Gatilho de reavaliação:**
escala pública grande, perfilamento de usuários, ou faturamento (art. 3º exclui quem
passa os limites da LC 123/2006).

## Alternativas consideradas e rejeitadas

1. **Manter o implícito** — rejeitado: prova mais fraca, e o upgrade é gratuito (o checkbox
   já existe).
2. **Dois checkboxes (18+ e Termos) ou três (+ Política)** — rejeitado: atrito sem ganho
   jurídico; "aceitar" a Política é o anti-padrão da Decisão 2.
3. **Consentimento como base principal** — rejeitado: base errada pra um serviço que só
   existe mediante conta; tornaria a revogação ambígua.
4. **Re-aceite forçado agora pra todos** — rejeitado: a revisão não reduz direitos (Decisão 5).

## Consequências

- `app/signin/sign-in-methods.tsx`: label novo; teste pina o texto do clickwrap
  (`app/signin/__tests__/sign-in-methods.test.tsx`).
- `/termos` §3 descreve o aceite; `/privacidade` §3 traz bases por finalidade e §13 o
  encarregado; testes de invariantes em `components/__tests__/legal-pages.test.tsx`.
- Issue #433 atendida por este branch.

## Citações não verificadas nesta sessão

LGPD art. 5º, XII; art. 7º (texto dos incisos I, V, IX); art. 8º, §§ 4º e 5º; art. 10;
art. 18, § 2º; Código Civil arts. 107 e 425. Res. CD/ANPD nº 2/2022 conferida só em fonte
secundária.
