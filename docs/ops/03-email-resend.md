# Sair do modo teste do Resend: verificar domínio e entregabilidade

Operacional. Hoje o Resend do Palpiteiro está em **modo teste**: sem domínio
verificado, ele só envia de `onboarding@resend.dev` e só entrega pro e-mail da
própria conta Resend. Isso trava o magic link pra qualquer outra pessoa — ou
seja, **bloqueia a Fase 2** (abrir pros amigos). Este doc te leva a verificar um
domínio próprio no Resend, configurar SPF/DKIM/DMARC e validar a entrega pra um
e-mail de fora.

Pra entender *por que* o modo teste se comporta assim e como o auth amarra
nisso, ver o runbook [`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md)
(seção "Modo teste do Resend"). Pra comprar o domínio e ter acesso ao painel de
DNS, ver [`01-dominio.md`](./01-dominio.md). Pra setar as envs na Vercel, ver
[`02-vercel-prod.md`](./02-vercel-prod.md).

> ⚠️ Pré-requisito de verdade: você precisa de um **domínio próprio**.
> Subdomínios `*.vercel.app` **não** podem ser verificados no Resend. Faça o
> [`01-dominio.md`](./01-dominio.md) primeiro.

## TL;DR da ordem

1. Tenha o domínio comprado e o painel de DNS acessível (ver [`01-dominio.md`](./01-dominio.md)).
2. Resend → **Domains** → **Add Domain** → use um **subdomínio de envio** (ex. `send.SEUDOMINIO`).
3. Cole os registros DNS que o Resend gera (MX, SPF/TXT, DKIM/TXT) no painel de DNS.
4. Adicione o registro **DMARC** (`_dmarc`, começando com `p=none`).
5. Volte ao Resend e clique **Verify DNS Records** até ficar tudo verde (pode levar até ~24 h).
6. Setar `RESEND_FROM_EMAIL=no-reply@send.SEUDOMINIO` na Vercel (ver [`02-vercel-prod.md`](./02-vercel-prod.md)) e adicionar os amigos em `ALLOWED_EMAILS`.
7. Mandar um magic link pra um e-mail que **não** seja o da conta Resend e confirmar a entrega.

## Estado atual: por que o magic link não chega nos amigos

A mesma `AUTH_RESEND_KEY` já está configurada e é usada por **dois** caminhos de
e-mail no app:

- o **magic link** do Auth.js (login), e
- o **alerta de gasto de IA** (cron `/api/cron/spend-alert`, opt-in via
  `DAILY_AI_SPEND_ALERT_USD` + `SPEND_ALERT_EMAIL`).

Os dois reusam `AUTH_RESEND_KEY` + `RESEND_FROM_EMAIL`. Em modo teste, o Resend
força o remetente pra `onboarding@resend.dev` e **só entrega pro e-mail da conta
Resend**. Resultado prático:

- Login solo funciona **se** o e-mail em `ALLOWED_EMAILS` for o mesmo da conta
  Resend (é o caso da Fase 1).
- Convidar um amigo **não** funciona: o Auth.js manda o e-mail, o Resend aceita,
  mas a entrega pra um destinatário externo é silenciosamente descartada.

Verificar um domínio é o que remove esse teto. Depois disso o Resend entrega pra
qualquer endereço e você pode enviar de um remetente do seu domínio.

## Passo 1 — Adicionar o domínio no Resend

> 💡 **Use um subdomínio de envio**, não o domínio raiz. O Resend recomenda
> enviar de um subdomínio (ex. `send.SEUDOMINIO` ou `updates.SEUDOMINIO`) "pra
> isolar a reputação de envio" — assim e-mail transacional não contamina (nem é
> contaminado por) o que quer que rode no domínio raiz. Cada subdomínio é
> adicionado e verificado de forma independente.
> Ref: [Resend — Domains](https://resend.com/docs/dashboard/domains/introduction).

1. Entre em [resend.com](https://resend.com) → menu lateral **Domains** → **Add Domain**.
2. Escreva o subdomínio de envio: `send.SEUDOMINIO` (troque pelo seu domínio real).
3. Escolha a região mais próxima (ex. um datacenter nos EUA/UE — não muda a entrega, só onde o e-mail é processado).
4. O Resend abre uma tela com os **registros DNS** a criar. Deixe essa aba aberta — você vai copiar os valores exatos dela.

## Passo 2 — Colar os registros DNS no registrar

O Resend gera 3 tipos de registro (os valores exatos saem na tela — **copie de
lá**, não invente):

| Tipo | Pra que serve | Host/Name (padrão) | Valor |
| --- | --- | --- | --- |
| **MX** | recebe bounces/reclamações do subdomínio de envio | `send.SEUDOMINIO` (ou `send`) | host MX que o Resend mostra, com a **prioridade** indicada |
| **TXT (SPF)** | lista quem pode enviar pelo seu domínio | `send.SEUDOMINIO` (ou `send`) | algo como `v=spf1 include:...resend... ~all` (copie da tela) |
| **TXT (DKIM)** | assina os e-mails com chave pública | `resend._domainkey.send` (o Resend mostra o nome) | a chave pública longa que o Resend gera |

Passo a passo no painel de DNS (o mesmo registrar do [`01-dominio.md`](./01-dominio.md)):

1. Abra **DNS → Records → Add record**.
2. Pra cada linha da tabela do Resend, selecione o **Type** correto (MX ou TXT).
3. Cole o **Name/Host** exatamente como o Resend mostra.
   - Atenção ao formato do seu provedor: alguns querem só `send`, outros o nome completo `send.SEUDOMINIO`. Se em dúvida, teste com o nome curto primeiro.
   - O MX leva também o campo **Priority** (use o valor que o Resend indicar).
4. Cole o **Value** sem espaços extras e sem cortar a chave DKIM (ela é longa).
5. Salve cada registro.

> ⚠️ O erro mais comum de verificação é colar os registros no **lugar errado**
> (domínio raiz em vez do subdomínio `send`) ou um valor que **não bate
> exatamente** com o que o Resend gerou. Se não verificar, confira esses dois
> pontos primeiro.
> Ref: [Resend — What if my domain is not verifying?](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying).

## Passo 3 — Adicionar o DMARC

DMARC diz aos provedores (Gmail, Outlook…) o que fazer com e-mail que **falha**
o alinhamento de SPF/DKIM, e te dá relatórios. SPF + DKIM + DMARC **alinhados** é
o que mais empurra o magic link da caixa de spam pra inbox: o Gmail confia mais
num remetente que se autentica nos três.

Crie **mais um** registro TXT (além dos do Passo 2):

| Tipo | Host/Name | Valor (comece assim) |
| --- | --- | --- |
| **TXT (DMARC)** | `_dmarc.SEUDOMINIO` (ou `_dmarc` no raiz) | `v=DMARC1; p=none; rua=mailto:dmarc@SEUDOMINIO;` |

Estratégia recomendada pelo próprio Resend — suba a "rigidez" só depois de
confirmar que o e-mail legítimo passa:

1. **`p=none`** (monitorar): não bloqueia nada, só coleta dados via relatórios `rua`. Comece aqui.
2. **`p=quarantine`** (transição): manda o que falha pro spam. Só depois de ver, nos relatórios, que seu magic link passa em SPF+DKIM.
3. **`p=reject`** (enforcement): rejeita o que falha. Estágio final, só depois de testar bem.

Pra Fase 2 (amigos), **`p=none` já basta**; evoluir pra `quarantine` é melhoria
incremental, não bloqueante.

> 💡 O `rua=mailto:...` define pra onde vão os relatórios agregados de DMARC. Use
> um e-mail seu que você cheque de vez em quando. Não é obrigatório, mas é o que
> torna o `p=none` útil (sem ele você está "monitorando" sem ver nada).
> Ref: [Resend — DMARC](https://resend.com/docs/dashboard/domains/dmarc).

## Passo 4 — Verificar no Resend

1. Volte na aba do Resend e clique **Verify DNS Records**.
2. Se os registros propagaram, cada linha fica **Verified** em verde.
3. Se ainda não, **espere** — propagação de DNS pode levar até ~24 h (geralmente bem menos). Clique de novo depois.
4. Pra debugar, cheque se os registros estão visíveis publicamente (ex. `dig TXT send.SEUDOMINIO` ou um lookup em [dns.email](https://dns.email)).

```bash
# checar SPF/DKIM/DMARC do terminal (troque SEUDOMINIO)
dig +short TXT send.SEUDOMINIO
dig +short TXT resend._domainkey.send.SEUDOMINIO
dig +short TXT _dmarc.SEUDOMINIO
dig +short MX  send.SEUDOMINIO
```

## Passo 5 — Apontar o remetente do app

Com o domínio **Verified**, troque o remetente. Na Vercel (Production + Preview)
e no `.env.local`, set:

```
RESEND_FROM_EMAIL=no-reply@send.SEUDOMINIO
```

(Pode ser `no-reply@SEUDOMINIO` se você verificou o domínio raiz, mas com o
subdomínio de envio o remetente deve estar **no subdomínio verificado**.)

> ⚠️ `AUTH_RESEND_KEY` **não muda** — a mesma chave que já existe continua
> valendo. Verificar domínio não gera nova API key; só destrava o remetente e a
> entrega externa. E lembre: como o **spend-alert reusa** `RESEND_FROM_EMAIL`,
> trocar essa env melhora a entrega **dos dois** e-mails (magic link e alerta de
> gasto) de uma vez.

Como passar a env na Vercel está em [`02-vercel-prod.md`](./02-vercel-prod.md).
Pra liberar os amigos, adicione os e-mails deles em `ALLOWED_EMAILS` (o gate
recusa fora-da-lista **antes** de enviar — detalhe em
[`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md)).

## Entregabilidade: o gotcha do spam no Gmail

Mesmo com tudo verificado, magic link **às vezes** cai em spam — especialmente
nas primeiras mensagens de um remetente novo (sem reputação ainda). Mitigações:

- **SPF + DKIM + DMARC alinhados** (Passos 2–3). É a base; sem isso o Gmail
  desconfia por padrão.
- **Remetente consistente**: sempre o mesmo `RESEND_FROM_EMAIL`. Não fique
  trocando o endereço de envio.
- **Avise os amigos da Fase 2**: na primeira vez, peça pra **checar o spam** e
  marcar **"não é spam" / "marcar como importante"**. Isso ensina o filtro do
  Gmail e as próximas mensagens caem na inbox.
- Conteúdo do magic link é simples e transacional (a favor da entrega), então o
  ganho real vem de autenticação + reputação ao longo do tempo.

> 💡 Reputação se constrói com volume baixo e constante. Os primeiros e-mails do
> domínio novo são os mais sujeitos a spam; depois melhora. Para Palpiteiro
> (poucos usuários, baixo volume) isso se estabiliza rápido.

## Limites do free tier

O free tier do Resend cobre folgado o cenário de amigos (Fase 2). Os números
mudam — **confira no link** antes de cravar:

| Item | Estimativa atual | Obrigatório pra Fase 2? |
| --- | --- | --- |
| E-mails/mês (free) | ~**3.000/mês** | não — é o teto do plano grátis, que já basta |
| E-mails/dia (free) | ~**100/dia** | não — mesma ideia |
| Domínios verificados (free) | ~**1** | sim, indireto: você precisa de **1** domínio verificado |
| Retenção de logs (free) | ~**30 dias** | não |
| Domínio próprio (registrar) | ver [`01-dominio.md`](./01-dominio.md) | **sim** — pré-requisito da verificação |

Valores mudam — confira na página oficial:
[Resend — Pricing](https://resend.com/pricing) e
[Resend — Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).

> 💡 O limite que costuma "pegar" primeiro é o de **100/dia**, não o de 3.000/mês.
> Pra Palpiteiro (login esporádico de poucos usuários + 1 alerta de gasto/dia) é
> irrelevante; só vale lembrar se um dia o app crescer (Fase 3, não planejada).

## Passo 6 — Verificação ponta a ponta

O teste que de fato prova que saiu do modo teste:

1. Garanta que `RESEND_FROM_EMAIL=no-reply@send.SEUDOMINIO` está na Vercel (Production) e que o deploy pegou a env nova.
2. Adicione em `ALLOWED_EMAILS` um e-mail que **não** seja o da conta Resend (ex. um Gmail seu ou de um amigo).
3. Vá em `/signin` e peça o magic link pra esse e-mail externo.
4. **Confirme a entrega** nesse e-mail externo (inbox **ou** spam). Se chegou de
   um remetente externo, o modo teste acabou.
5. Se caiu em spam, marque "não é spam" e siga as dicas da seção de
   entregabilidade acima.
6. Clique o link e confirme que loga normalmente.

> ⚠️ Se não chegar **nada** pra um e-mail externo, você ainda está em modo teste:
> revise se o domínio está **Verified** no Resend e se `RESEND_FROM_EMAIL` aponta
> pro domínio verificado (e não ficou em `onboarding@resend.dev`).

## DECISÃO do usuário

> 🟡 **Você ainda não escolheu o domínio.** Tudo aqui depende dele
> (`send.SEUDOMINIO`, `no-reply@...`, registros DNS). Resolva o
> [`01-dominio.md`](./01-dominio.md) primeiro.
>
> **Recomendação default**: verifique um **subdomínio de envio** `send.SEUDOMINIO`
> (em vez do raiz) para isolar reputação, e comece o DMARC em **`p=none`**. São
> só recomendações — a escolha do domínio e da política DMARC é sua.

## Próximos passos e cross-links

- Ainda não tem domínio? → [`01-dominio.md`](./01-dominio.md) (comprar + apontar DNS).
- Setar `RESEND_FROM_EMAIL` / `ALLOWED_EMAILS` na Vercel → [`02-vercel-prod.md`](./02-vercel-prod.md).
- Como o auth usa o Resend e o que é o modo teste → [`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md).
- Decisão de auth multiusuário (whitelist por env + DB) → [`docs/decisions/0007-auth-multiuser-jwt-env-whitelist.md`](../decisions/0007-auth-multiuser-jwt-env-whitelist.md).
- Checklist final antes de abrir pros amigos → [`07-checklist-go-live.md`](./07-checklist-go-live.md).

### Fontes oficiais

- [Resend — Domains (introduction)](https://resend.com/docs/dashboard/domains/introduction)
- [Resend — DMARC](https://resend.com/docs/dashboard/domains/dmarc)
- [Resend — What if my domain is not verifying?](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying)
- [Resend — Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Resend — Pricing](https://resend.com/pricing)
