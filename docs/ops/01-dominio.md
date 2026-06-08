# Comprar o domínio e apontar pra Vercel

Hoje o Palpiteiro roda num subdomínio `*.vercel.app`. Pra destravar a **Fase 2**
(abrir pros amigos), o primeiro passo é ter um **domínio próprio**: ele é
pré-requisito pra verificar e-mail no Resend (sem isso, magic link só chega pra
você), dá uma URL apresentável e vira a base da marca. Este doc te leva de
"ainda não decidi o nome" até "DNS apontado e SSL emitido na Vercel".

> ⚠️ Por que o domínio é o gargalo da Fase 2: subdomínios `*.vercel.app` **não**
> podem ser verificados no Resend (ver
> [`03-email-resend.md`](./03-email-resend.md)). Enquanto você estiver em
> `*.vercel.app`, o Resend fica em modo teste e **só entrega pro e-mail da sua
> própria conta Resend** — ou seja, nenhum amigo recebe magic link. Comprar o
> domínio é o que destrava o convite.

## TL;DR da ordem

1. **Decidir o nome** (callout de decisão abaixo) — e checar handles sociais junto.
2. **Checar disponibilidade** no registro.br (.com.br) ou num whois (.com/.app).
3. **Comprar** no registrador certo pra extensão escolhida.
4. **Adicionar o domínio** na Vercel: Project → Settings → Domains → Add.
5. **Colar os registros DNS** (A/CNAME) ou trocar os **nameservers** no painel do registrador.
6. Esperar a **propagação** + a Vercel **emitir o SSL** automaticamente.
7. Seguir pra [`02-vercel-prod.md`](./02-vercel-prod.md) e [`03-email-resend.md`](./03-email-resend.md).

## Decisão: qual extensão de domínio

> 🟡 **DECISÃO DO USUÁRIO — nome ainda não definido.** Candidato mencionado:
> `palpiteiro.com.br`. As opções `.com` e `.app` também estão na mesa. A tabela
> abaixo compara; a escolha é sua.

| Extensão | Onde registra | Exige CPF/CNPJ? | Prós | Contras |
| --- | --- | --- | --- | --- |
| **`.com.br`** | registro.br (direto) | **Sim** — titular precisa de CPF (pessoa física) ou CNPJ, com contato no Brasil | Sinaliza Brasil pro público-alvo; barato e estável; sem markup; renovação = preço de registro | WHOIS público (dados do titular ficam expostos — registro.br não oferece privacidade); só faz sentido pra público BR |
| **`.com`** | Cloudflare Registrar, Namecheap, etc. | Não | Universal, reconhecido em qualquer lugar; fácil de transferir entre registradores | Mais disputado (bons nomes já tomados); preço varia mais por registrador |
| **`.app`** | Cloudflare Registrar, Namecheap, etc. | Não | Moderno, combina com web app; **HTTPS forçado** por design (TLD está na HSTS preload list) | O HTTPS obrigatório **exige SSL válido** — sem certificado o domínio literalmente não abre (a Vercel emite SSL automático, então na prática isso não é problema aqui) |

> 💡 **Recomendação default (não obrigatória):** se o público é Brasil — família e
> amigos, é o caso aqui —, **`palpiteiro.com.br`** é a escolha mais natural e a
> mais barata. Se você quer algo "universal" ou pensa em mostrar fora do BR,
> `.com`. `.app` é estiloso e o HTTPS-by-default não te atrapalha (a Vercel já
> serve tudo em HTTPS), mas não traz vantagem concreta sobre as outras pro seu
> caso. **Escolha sua.**

> 💡 Cheque os **handles sociais** (Instagram, X, etc.) ao mesmo tempo que o
> domínio — não adianta `palpiteiro.com.br` livre se o @palpiteiro já é de outro.
> Isso também conversa com o registro de marca; ver
> [`06-marca-inpi.md`](./06-marca-inpi.md).

### Sobre o `.app` e HTTPS obrigatório

O `.app` é um TLD do Google Registry que está **inteiro na HSTS preload list** —
todo domínio `.app` é forçado a carregar só por HTTPS pelos navegadores, sem
fallback pra HTTP. Na prática, com a Vercel isso é transparente: ela emite SSL
automático e serve tudo em HTTPS. Só fique ciente de que, durante a janela em que
o SSL ainda não foi emitido, um `.app` **não abre de jeito nenhum** (um `.com` ou
`.com.br` abriria em HTTP). Fonte:
[Porkbun — HSTS Preload and Google Registry](https://kb.porkbun.com/article/96-hsts-preload-and-google-registry).

## 1. Checar disponibilidade

### `.com.br`

Use a busca oficial do registro.br:

- Busca de domínio: <https://registro.br/busca-dominio/>

Digite `palpiteiro` e veja se `.com.br` está livre. Se estiver "em processo de
liberação", o domínio existiu e foi liberado recentemente — leia o status antes
de contar com ele.

### `.com` / `.app`

Use a busca do registrador internacional escolhido, ou um whois pela linha de
comando:

```bash
# disponível normalmente retorna "No match" / "NOT FOUND"
whois palpiteiro.com
whois palpiteiro.app
```

Ou a busca da Cloudflare: <https://domains.cloudflare.com/>.

## 2. Onde comprar

> 💰 Preços abaixo são **estimativas de junho/2026** e **mudam** — confira sempre
> no link oficial antes de pagar.

| Extensão | Registrador recomendado | Preço estimado/ano | Observações |
| --- | --- | --- | --- |
| `.com.br` | **registro.br** (direto) | ~R$ 40/ano (registro = renovação, sem markup) | Único registrador oficial do `.br`. Exige CPF/CNPJ. WHOIS público. Confira: [registro.br/busca-dominio](https://registro.br/busca-dominio/) (valores mudam) |
| `.com` | **Cloudflare Registrar** | ~US$ 10,44/ano (preço de custo, sem lucro) | **Exige usar o DNS da Cloudflare** (nameservers da Cloudflare). Sem markup, renovação = registro. Confira: [cloudflare.com/products/registrar](https://www.cloudflare.com/products/registrar/) (valores mudam) |
| `.com` / `.app` | **Namecheap** (alternativa) | varia (cuidado com preço de 1º ano "promo" que sobe na renovação) | Não te prende a um DNS específico; bom se você não quer migrar pra Cloudflare. Confira: [namecheap.com](https://www.namecheap.com/) (valores mudam) |
| qualquer | **Vercel Domains** | mais caro que os acima | Conveniência: compra e DNS no mesmo lugar, sem mexer em registrador externo. Você paga essa conveniência. Doc: [vercel.com/docs/domains](https://vercel.com/docs/domains) (valores mudam) |

> 💡 **Trade-off da Cloudflare:** ela vende `.com`/`.app` a **preço de custo** (não
> tem lucro na venda), mas **só funciona se o domínio usar os nameservers da
> Cloudflare**. Pra você isso é tranquilo: dá pra apontar o DNS da Cloudflare pra
> Vercel via CNAME/A (caminho A da próxima seção). Se não quiser usar Cloudflare
> DNS, vá de Namecheap.

> ⚠️ Cuidado com **preço de primeiro ano promocional** (comum no Namecheap e em
> hosts BR de revenda): registra barato e a **renovação** sobe. registro.br e
> Cloudflare **não** fazem isso — registro = renovação.

## 3. Apontar o DNS pra Vercel

Existem **dois caminhos**. Escolha um:

| Caminho | Quando usar | O que você faz |
| --- | --- | --- |
| **(A) Registros A/CNAME** | Você quer manter o DNS no registrador atual (ou na Cloudflare) e só apontar pra Vercel | No registrador, cria um registro **A** (apex, ex.: `palpiteiro.com.br`) e/ou **CNAME** (subdomínio, ex.: `www`) com os valores que a Vercel te dá |
| **(B) Nameservers da Vercel** | Você quer que a Vercel gerencie todo o DNS | Troca os **nameservers** do domínio no registrador pelos da Vercel. **Obrigatório** se usar wildcard (`*.dominio`) |

Para o Palpiteiro (um app, um apex + `www`), o **caminho (A)** é suficiente e
mais simples. O (B) só compensa se você for centralizar o DNS na Vercel.

### Passo a passo (caminho A, recomendado)

1. Na Vercel, abra o projeto → **Settings** → **Domains**.
2. Clique **Add Domain** e digite o domínio (ex.: `palpiteiro.com.br`).
   - Ao adicionar um **apex** (ex.: `palpiteiro.com.br`), a Vercel sugere também
     adicionar o `www`. Aceite — é boa prática ter os dois e redirecionar um pro
     outro.
3. A Vercel mostra os **valores DNS** que você precisa criar. Tipicamente:
   - **Apex** → um registro **A** apontando pro IP que a Vercel exibe (a Vercel
     mostra o IP atual na própria tela — **use o que ela mostrar**, não decore um
     valor; pode mudar).
   - **Subdomínio** (ex.: `www`) → um registro **CNAME** apontando pro alvo único
     do seu projeto, no formato `<hash>.vercel-dns-017.com` (a Vercel mostra o
     seu).
4. Vá no painel do **registrador** (registro.br, Cloudflare, Namecheap…) e
   **crie esses registros** exatamente como a Vercel mostrou.
   - No **registro.br**: painel do domínio → **Editar zona / DNS** → adicionar
     registro A e CNAME.
   - Na **Cloudflare**: aba **DNS** → **Add record**. Para o apex via CNAME, a
     Cloudflare faz "CNAME flattening" automático, então dá pra usar CNAME no apex
     se preferir.
5. Volte na Vercel e aguarde a verificação. O status muda pra **configurado** /
   válido quando os registros propagarem.

> ⚠️ **Propagação de DNS** não é instantânea — costuma levar de minutos a algumas
> horas (o TTL e o registrador influenciam). Não entre em pânico se a Vercel
> mostrar "Invalid Configuration" nos primeiros minutos; recarregue depois.

> 💡 **SSL é automático.** Assim que a Vercel verifica o domínio, ela **emite e
> renova o certificado TLS sozinha** (Let's Encrypt). Você não cola certificado
> manualmente. Isso vale pra `.com.br`, `.com` e `.app` — e é o que satisfaz a
> exigência de HTTPS do `.app`.

### Passo a passo (caminho B, nameservers)

1. Na Vercel, **Add Domain** como acima. Se você adicionar um **wildcard**
   (`*.palpiteiro.com.br`), a Vercel **ativa os nameservers dela automaticamente**
   e te mostra os endereços.
2. No registrador, troque os **nameservers** do domínio pelos que a Vercel
   forneceu.
3. **Migre antes** quaisquer registros DNS que você queira manter (ex.: MX de
   e-mail) pra dentro da Vercel — ao trocar os nameservers, o registrador atual
   **para de responder** pelo seu DNS.

> ⚠️ Trocar nameservers **substitui todo o DNS** daquele domínio. Se você já tem
> e-mail, registros MX, ou qualquer outra coisa no domínio, recrie tudo na Vercel
> antes, senão quebra.

Doc oficial dos passos:
[Vercel — Adding & Configuring a Custom Domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

## Por que isso destrava a Fase 2

Com o domínio próprio apontado e SSL emitido, você ganha de uma vez:

- **(a) E-mail pros amigos:** agora dá pra **verificar o domínio no Resend** e sair
  do modo teste, enviando magic link e alertas pra qualquer e-mail da whitelist.
  `*.vercel.app` **nunca** permite isso. Ver
  [`03-email-resend.md`](./03-email-resend.md).
- **(b) URL apresentável:** `palpiteiro.com.br` em vez de
  `palpiteiro-xyz.vercel.app` — pra mandar pros amigos sem parecer rascunho.
- **(c) Base pra marca:** o nome do domínio é o ponto de partida pro registro de
  marca e pros handles sociais. Ver [`06-marca-inpi.md`](./06-marca-inpi.md).

## Próximos passos / cross-links

- **Configurar o domínio custom na Vercel** (apontar o domínio pro projeto de
  produção, matriz de env vars, crons): [`02-vercel-prod.md`](./02-vercel-prod.md).
- **Verificar o domínio no Resend** (sair do modo teste, entregabilidade):
  [`03-email-resend.md`](./03-email-resend.md).
- **Marca e handles sociais** (INPI, avaliar/adiar):
  [`06-marca-inpi.md`](./06-marca-inpi.md).
- **Índice e ordem recomendada:** [`README.md`](./README.md).

## Fontes (preços e limites mudam — sempre confira no link)

- [registro.br — busca de domínio](https://registro.br/busca-dominio/)
- [registro.br — categorias .br (requisitos)](https://registro.br/dominio/categorias/)
- [Cloudflare Registrar — preço de custo](https://www.cloudflare.com/products/registrar/)
- [Vercel — Adding & Configuring a Custom Domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel Domains (compra direta)](https://vercel.com/docs/domains)
- [Porkbun — HSTS Preload and Google Registry (.app)](https://kb.porkbun.com/article/96-hsts-preload-and-google-registry)
