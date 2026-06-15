# ADR 0004 — Auth.js v5 com magic link via e-mail

## Status
Accepted (2026-05) — **emendado pelo ADR 0007**: o mecanismo de whitelist passou
de tabela DB (`users.allowed_emails`) para env `ALLOWED_EMAILS` no MVP (#12). A
escolha de Auth.js v5 + magic link via Resend permanece. **Emendado também
pelo ADR 0023**: OAuth/passkey são aceitos cedo (a "Fase 3" hipotética some);
senha+e-mail **segue rejeitada**.

## Contexto

Fase 1 é uso pessoal (não precisa de auth real, mas quero deixar pronto pra Fase 2). Fase 2 é família e amigos via whitelist controlada manualmente. Sem necessidade de OAuth com Google/GitHub no MVP.

Requisitos:
- Whitelist forte por design (só pessoas autorizadas entram)
- Atrito mínimo no login
- Sem dependências externas pesadas
- Compatível com Next.js 15 + Drizzle

## Decisão

**Auth.js v5** (NextAuth) com **magic link por e-mail** via Resend. Whitelist controlada manualmente via tabela `users`.

## Razão

1. **Zero atrito**: usuário digita e-mail, recebe link, clica, está dentro. Sem senha pra esquecer
2. **Whitelist trivial**: na verificação do callback, checa se o e-mail está em `users.allowed_emails` — fora disso, recusa login
3. **Sem dependência externa de OAuth**: não precisa de Google Cloud Console, App Registration na Apple, etc.
4. **Auth.js v5**: padrão de fato em Next.js; bem documentado; integra com Drizzle via adapter
5. **Resend**: free tier 100 e-mails/dia + 3.000/mês; suficiente pra Fase 1+2; deliverability decente
6. **Simples de evoluir**: se a Fase 3 chegar, adicionar OAuth providers (Google, GitHub) é só configuração

## Alternativas consideradas

- **Clerk**: ótima UX, mas vendor lock-in e custo crescem com usuários; overkill pra Fase 1+2
- **Supabase Auth**: bom, mas só usaria isso (não o resto do Supabase) — preferi não acoplar
- **OAuth Google + GitHub**: mais fricção pro setup inicial; pode entrar na Fase 3 sem refator pesado
- **Senha + e-mail tradicional**: rejeitada — fricção desnecessária pra usuário e responsabilidade extra de hash, recovery, etc.

## Consequências

- (+) Setup rápido e gratuito
- (+) Whitelist forte por design (não é validação cosmética)
- (+) UX moderna sem custo
- (−) Depende de SMTP confiável (Resend resolve; alternativa: SendGrid)
- (−) E-mail pode cair em spam ocasionalmente — comunicar pra usuários da Fase 2 olharem pasta de spam no primeiro login
- (−) Menos "polido" que Clerk pra produto público, mas refatorável na Fase 3
