# Conformidade legal: 18+, jogo responsável, LGPD e termos

Este doc cobre o mínimo legal/ético pra abrir o Palpiteiro pros amigos (Fase 2) —
um app **sobre** apostas que **não movimenta dinheiro real**. O Palpiteiro gera
recomendações de seleção de edge multi-mercado (mercado + linha + confiança) com
racional e faz tracking de Yield hipotético; a aposta de
verdade o usuário faz por conta dele, numa casa `.bet.br` autorizada, **fora** do
app.

> ⚠️ **ISTO NÃO É ACONSELHAMENTO JURÍDICO.** É um checklist de boa prática feito
> por engenheiro, com base em pesquisa pública. Pra **abrir ao público (Fase 3)**
> ou **monetizar**, valide com um advogado especializado em direito digital /
> apostas — aí o risco e as obrigações mudam de patamar. Para a escala
> "família e amigos" (whitelist, 3-5 pessoas, sem dinheiro entrando no app) o
> risco é **baixo**, mas o básico abaixo continua sendo a coisa certa a fazer.

## TL;DR da ordem

1. Decidir o **enquadramento** (você não é operador — leia a seção 1) e botar isso
   por escrito nos Termos.
2. Adicionar **gate/aviso 18+** no acesso.
3. Colocar **disclaimers de jogo responsável + risco** no footer e na tela de
   resultado da análise.
4. Publicar duas páginas: **`/termos`** (Termos de Uso) e **`/privacidade`**
   (Política de Privacidade LGPD).
5. Linkar as duas no footer, no `/signin` e na confirmação do convite.
6. Guardar a versão/data de cada página (forward-only, igual migration — ver
   seção LGPD).

Nada aqui depende de domínio próprio, então dá pra fazer antes do
[`01-dominio.md`](./01-dominio.md). Mas o texto das páginas precisa citar **quem é
o controlador** e **um e-mail de contato** — então é mais limpo fazer depois de
ter o e-mail/domínio definido (ver [`03-email-resend.md`](./03-email-resend.md)).

---

## 1. Posicionamento: o Palpiteiro NÃO é casa de aposta

A peça central da sua defesa legal é simples e verdadeira: **o app não é um
operador de apostas.** Deixe isso explícito nos Termos e seja consistente no
produto.

| O que o Palpiteiro faz | O que o Palpiteiro **não** faz |
| --- | --- |
| Gera recomendações de seleção de edge multi-mercado (mercado + linha + confiança) com racional | Aceita depósito, saldo ou dinheiro real |
| Calcula e mostra Yield **hipotético** | Processa pagamento ou paga prêmio |
| Registra predições e resultados (tracking) | Casa a aposta / segura a posição |
| Conteúdo informativo/educacional | Garante resultado ou lucro |

Por que isso importa: a [Lei nº 14.790/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14790.htm)
regula a **exploração comercial de apostas de quota fixa** — quem **opera** a
aposta (recebe o valor, define a quota, paga o prêmio). Esse é o sujeito que
precisa de **autorização da SPA** (Secretaria de Prêmios e Apostas / Ministério da
Fazenda) e do domínio `.bet.br`. O Palpiteiro **não faz nada disso**: a aposta real
acontece **fora** do app, numa casa `.bet.br` autorizada, com dinheiro do próprio
usuário. Logo, **você não se enquadra como operador** e **não precisa de licença
de operador**.

> ✅ **Isso reduz muito a carga regulatória — mas não zera.** Você ainda coleta
> e-mail (⇒ LGPD), trata de tema adulto (⇒ 18+), e fala de apostas (⇒ jogo
> responsável + cuidado pra não fazer publicidade enganosa). As próximas seções
> cobrem exatamente esse "resíduo".

> ⚠️ **Não se descreva como "casa de apostas", "bookmaker", "bet" ou prometa
> retorno.** Linguagem importa: anunciar lucro garantido pode te jogar pra dentro
> de regras de publicidade de apostas (seção 6) e de propaganda enganosa (CDC),
> mesmo sem você operar nada. Trate o app como **ferramenta de análise**.

---

## 2. Gate / aviso 18+

Tema de apostas ⇒ conteúdo adulto. Você precisa sinalizar **18+** de forma
visível. Como o acesso já é fechado por whitelist + magic link (ninguém entra sem
você convidar), um **gate bloqueante** com modal é opcional — mas o **aviso**
não é.

Mínimo recomendado pra Fase 2:

- **Selo `18+`** persistente no footer (ver seção 7).
- **Linha de confirmação** no `/signin` e/ou na primeira sessão: "Ao continuar,
  você declara ter 18 anos ou mais." (basta texto + o ato de logar; não precisa
  de checkbox separado nessa escala, mas um checkbox é mais defensável).
- Reforço nos **Termos** (seção 5): o serviço é destinado a maiores de 18 anos.

> 💡 Como você convida cada usuário manualmente (whitelist), na prática você já
> sabe que são adultos. O aviso é pra deixar **registrado** e pra criar o hábito
> certo antes da Fase 3, onde o gate vira obrigatório.

---

## 3. Jogo responsável + aviso de risco

Mesmo sem operar apostas, você está incentivando uma atividade de risco. Coloque
mensagens de **jogo responsável** e **canais de ajuda** de forma legível e
recorrente. Isso é ético e, de quebra, alinha com as mensagens que o
[CONAR exige da publicidade de apostas](https://www.conar.org.br/pdf/CONAR-ANEXO-X-PUBLICIDADE-APOSTAS-dezembro-2023.pdf)
(você não é anunciante de casa, mas o tom é a referência certa).

Texto sugerido (adapte; mantenha curto e honesto):

> **Aposta não é investimento.** As recomendações do Palpiteiro são análises e
> **não garantem resultado**. Aposte com responsabilidade, só o que você pode
> perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão,
> procure ajuda.

Canais de ajuda pra listar (gratuitos, Brasil):

| Canal | Para quê | Contato |
| --- | --- | --- |
| **CVV** (Centro de Valorização da Vida) | Apoio emocional / crise, 24h | Ligue **188** · [cvv.org.br](https://www.cvv.org.br/) |
| **Jogadores Anônimos** | Grupos de apoio a vício em jogo | [jogadoresanonimos.com.br](https://jogadoresanonimos.com.br/) |

Onde mostrar:

- **Footer** (selo + frase curta de jogo responsável) — em toda página.
- **Tela de resultado da análise** (o momento de maior intenção de apostar) — uma
  linha de aviso de risco perto da recomendação.
- **Página de Termos** — bloco dedicado.

> ⚠️ **Nunca** sugira aposta como fonte de renda, jeito de "ganhar dinheiro
> fácil", ou estímulo a apostar mais/recuperar perdas. Esse é o tipo de mensagem
> proibida na publicidade de apostas e o que mais pega mal num app do tema.

---

## 4. LGPD — Política de Privacidade (`/privacidade`)

O app coleta **e-mail** (autenticação por magic link) e **dados de uso**
(predições, histórico, logs). E-mail é dado pessoal ⇒ a
[LGPD (Lei nº 13.709/2018)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
se aplica **mesmo em escala pequena**. Você é o **controlador**.

Princípio que te guia: **necessidade / minimização** — só colete o estritamente
necessário. Hoje o Palpiteiro já faz isso (e-mail + uso), então a Política só
precisa **descrever a verdade**.

A `/privacidade` deve conter, no mínimo:

| Item | O que escrever (caso Palpiteiro) |
| --- | --- |
| **Controlador + contato** | Seu nome (ou nome do projeto) + um e-mail de contato (ex.: o `RESEND_FROM_EMAIL` do seu domínio, ou um e-mail dedicado tipo `privacidade@seudominio`). |
| **Dados coletados** | E-mail (login); dados de uso (predições, resultados, histórico de análise); logs técnicos (acesso, custo de IA por usuário). |
| **Finalidade** | Autenticar o acesso; operar o app (gerar/guardar predições e tracking); controlar custo/uso (rate limit, alerta de gasto). |
| **Base legal** | E-mail/operação: **execução do serviço** que o usuário pediu (e/ou **consentimento** ao se cadastrar). Sem marketing, sem venda de dados. |
| **Compartilhamento (sub-operadores)** | Liste os terceiros que processam dados: **Vercel** (hosting/logs), **Neon** (banco), **Resend** (envio de e-mail), **Anthropic** (texto da análise), **Upstash/Vercel KV** (rate limit). |
| **Retenção** | Por quanto tempo guarda (ex.: enquanto a conta existir; logs por X meses). Seja honesto com o que o sistema faz hoje. |
| **Direitos do titular** | Acesso, correção, **exclusão**, portabilidade, revogação de consentimento — e como pedir (manda e-mail pro contato). |
| **Exclusão de dados** | Como o usuário pede pra ser apagado e o que acontece (conta + dados associados removidos; histórico anônimo pode ser mantido se desidentificado). |
| **Versão + data** | "Última atualização: AAAA-MM-DD". |

> 💡 **Transferência internacional:** Vercel, Neon, Resend, Anthropic e Upstash
> hospedam fora do Brasil. A LGPD permite, mas a boa prática é **mencionar** que
> há tratamento no exterior por esses provedores. Uma linha basta na escala atual.

> ⚠️ **Direito de exclusão é operacional, não só texto.** Antes de prometer
> "apagamos seus dados", tenha um caminho real: hoje seria deletar a row do
> usuário e dados associados (ver tabela de whitelist no
> [ADR 0009](../decisions/0009-whitelist-db-table.md) e o claim de admin em
> [`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md)). Em escala de amigos,
> "me manda e-mail que eu apago manualmente" é aceitável — **mas escreva isso**.

Referências oficiais (contexto, valores/regras mudam — confira nos links):
[LGPD na íntegra](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) ·
[ANPD — Autoridade Nacional de Proteção de Dados](https://www.gov.br/anpd/pt-br) ·
[ANPD — guia de legítimo interesse e bases legais](https://www.gov.br/anpd/pt-br/documentos-e-publicacoes).

---

## 5. Termos de Uso (`/termos`)

Os Termos fixam **o que o app é** (e o que não é) e limitam sua responsabilidade.
Deve conter, no mínimo:

| Item | O que escrever |
| --- | --- |
| **Natureza do serviço** | Ferramenta **informativa/educacional** de análise. **Não** é casa de apostas, não aceita dinheiro, não casa apostas, não garante resultado. |
| **Sem garantia de resultado** | Recomendações são opinião analítica baseada em dados e IA; podem estar erradas; passado não garante futuro; o usuário decide e assume o risco. |
| **Limitação de responsabilidade** | Você não se responsabiliza por perdas decorrentes de apostas feitas pelo usuário fora do app. |
| **18+** | Serviço destinado a maiores de 18 anos. |
| **Conduta** | Acesso por convite (whitelist); proibido compartilhar/abusar; você pode revogar acesso. |
| **IA** | A análise é gerada por modelo de IA (Claude/Anthropic) e pode conter erros; não é conselho financeiro. |
| **Mudanças** | Você pode alterar o serviço/termos; mudanças materiais são comunicadas. |
| **Versão + data** | "Última atualização: AAAA-MM-DD". |

> 💡 Mantenha curto e em português claro. Numa escala de amigos, Termos honestos
> de uma página valem mais que um contrato de 10 páginas copiado de uma casa de
> apostas (que, aliás, traria obrigações de operador que **não** são suas).

---

## 6. Contexto regulatório (Lei 14.790/2023, SPA e `.bet.br`)

> ⚠️ **Contexto, não parecer jurídico.** Resumo do cenário público em 2025-2026 —
> as regras estão se assentando e mudam; confira sempre nas fontes oficiais.

O que mudou no Brasil:

- A [Lei nº 14.790/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14790.htm)
  criou o marco das apostas de quota fixa. A regulação e fiscalização ficam com a
  **SPA — Secretaria de Prêmios e Apostas**, no Ministério da Fazenda
  ([SPA / Apostas de Quota Fixa — gov.br](https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/apostas-de-quota-fixa)).
- Desde **1º de janeiro de 2025**, só **operadores autorizados** pela SPA podem
  operar nacionalmente, e usam o domínio **`.bet.br`**. Site de aposta sem
  `.bet.br` autorizado é irregular.
- Em 2025 saíram portarias adicionais (ex.: proteção social, módulo de impedidos
  do SIGAP). Acompanhe pela página da SPA.

**O que isso significa pra um NÃO-operador (você, hoje):**

- Você **não precisa de licença de operador** nem de domínio `.bet.br` — porque
  não opera aposta. Seu app é ferramenta de análise informativa.
- Você continua sujeito às leis gerais: **LGPD** (seção 4), **CDC** (não enganar o
  consumidor) e bom senso de **18+ / jogo responsável** (seções 2-3).

**Risco futuro (alerta pra Fase 3, NÃO bloqueador agora):**

> 🚩 Se um dia o app **linkar pra casas de apostas** (botão "apostar na casa X",
> link de afiliado, banner), você deixa de ser só "ferramenta" e vira
> **publicidade/afiliação de apostas** — aí entram as regras de publicidade
> (autorregulação do **CONAR**, [Anexo X — Apostas](https://www.conar.org.br/pdf/CONAR-ANEXO-X-PUBLICIDADE-APOSTAS-dezembro-2023.pdf),
> e diretrizes de Senacon/órgãos de consumo), mensagens obrigatórias de jogo
> responsável, restrição a menores, e potencialmente as regras do próprio
> operador. **Enquanto você NÃO linkar pra casa nenhuma e NÃO monetizar, isso não
> se aplica.** Se for monetizar/linkar na Fase 3 ⇒ advogado primeiro.

Fontes (contexto, confira nos links — regras mudam):
[Lei 14.790/2023 (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14790.htm) ·
[SPA / Ministério da Fazenda](https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas) ·
[CONAR — regras de publicidade de apostas](https://www.conar.org.br/pdf/conar-regras-apostas-folder-web.pdf).

---

## 7. Concreto: o que adicionar no app

Tudo greenfield — hoje não existe footer, página de Termos nem de Privacidade no
repo. Use os padrões do projeto (Server Components por padrão, `app/` App Router).

### Páginas (rotas estáticas)

- `app/termos/page.tsx` → **`/termos`** (conteúdo da seção 5).
- `app/privacidade/page.tsx` → **`/privacidade`** (conteúdo da seção 4).

São páginas de conteúdo estático (texto), Server Components, sem auth — devem ser
acessíveis **antes** do login (linkadas no `/signin`).

### Footer global (toda página, incl. `/signin`)

Conteúdo do footer:

- Selo **`18+`**.
- Frase curta de jogo responsável: _"Aposte com responsabilidade. Aposta não é
  investimento."_
- Links: **Termos** (`/termos`) · **Privacidade** (`/privacidade`) · **CVV 188**.
- Mini-disclaimer: _"Palpiteiro é uma ferramenta de análise. Não é casa de
  apostas e não aceita dinheiro real."_

### Tela de resultado da análise

Já existe `components/analysis-result.tsx`. Adicione **uma linha** de aviso de
risco perto da recomendação: _"Recomendação analítica, sem garantia de resultado.
Aposte com responsabilidade."_

### Checklist do que cada peça deve conter

- [ ] **Footer**: selo 18+, frase de jogo responsável, links Termos/Privacidade,
      CVV 188, disclaimer "não é casa de apostas".
- [ ] **`/termos`**: natureza (informativo, não-operador), sem garantia,
      limitação de responsabilidade, 18+, conduta, IA, versão+data.
- [ ] **`/privacidade`**: controlador+contato, dados, finalidade, base legal,
      sub-operadores (Vercel/Neon/Resend/Anthropic/Upstash), retenção, direitos,
      exclusão, transferência internacional, versão+data.
- [ ] **`/signin`**: linha "ao continuar você declara ter 18+", links pra
      Termos/Privacidade.
- [ ] **Resultado da análise**: linha de aviso de risco.
- [ ] **Gate de 18+ no cadastro aberto** (#282): o fluxo de convite foi removido
      (#281; cadastro aberto #257), então a confirmação de 18+/Termos precisa de um
      novo ponto de captura cobrindo **todos** os métodos (Google/passkey/magic link).
      O item de `/signin` acima ("declara ter 18+") é o piso mínimo; o #282 decide se
      há tela de consentimento com auditoria por usuário.

> 💡 **Versão das páginas é forward-only**, igual migration. Carimbe
> "Última atualização: AAAA-MM-DD" em cada página e bump a data quando mudar o
> texto material. Numa disputa, você quer poder dizer **qual versão** estava no ar
> quando o usuário aceitou.

---

## Custos

Conformidade de Fase 2 é, em essência, **escrever texto e adicionar componentes** —
custo de dinheiro ≈ R$ 0. O custo é de tempo.

| Item | Estimativa | Obrigatório p/ Fase 2? |
| --- | --- | --- |
| Páginas `/termos` e `/privacidade` | R$ 0 (você escreve) · ~algumas horas | **Sim** |
| Footer com 18+ / jogo responsável / disclaimer | R$ 0 · ~1h | **Sim** |
| Aviso de risco na tela de análise | R$ 0 · minutos | **Sim** |
| Revisão por advogado (digital/apostas) | ~R$ 0 agora; estimar só na Fase 3 | **Não** (recomendado só p/ Fase 3) |
| Encarregado/DPO formal, ROPA, etc. (LGPD avançado) | R$ 0 agora | **Não** (escala pequena) |

> 💡 Pra "família e amigos" você **não** precisa de DPO formal, registro na ANPD,
> nem revisão jurídica paga. Precisa das páginas + disclaimers + um caminho real
> de exclusão de dados. O advogado entra **quando** for abrir ao público ou
> monetizar (Fase 3).

---

## Decisões abertas (suas)

> ✅ **Decididas em 2026-09-24** (revisão legal delegada — [Report 11](../reports/11-revisao-legal.md)):
> gate 18+ = autodeclaração ([ADR 0041](../decisions/0041-envelope-regulatorio-nao-operador-sem-vinculo-com-casas.md) D5);
> contato = `contato@palpiteiro.live` (confirmar recebimento); aceite **explícito** dos Termos no
> checkbox do 18+ ([ADR 0040](../decisions/0040-consentimento-clickwrap-e-base-legal-lgpd.md));
> controlador = pessoa física, nome civil a publicar pelo dono (slot em `lib/legal/controller.ts`).
> Exclusão de conta: [ADR 0039](../decisions/0039-exclusao-de-conta-lgpd-tombstone-e-anonimizacao.md).
> O texto abaixo fica como registro histórico.

> 🟦 **DECISÃO — Gate 18+ bloqueante vs. apenas aviso.**
> Recomendação default: **só aviso** (selo no footer + linha no `/signin`), já que
> o acesso é por whitelist e você conhece quem entra. Reavalie pra Fase 3, onde
> um gate bloqueante (modal de confirmação de idade) passa a ser esperado.
> Escolha sua.

> 🟦 **DECISÃO — E-mail de contato do controlador na Política.**
> Recomendação default: usar um e-mail do seu domínio próprio (ex.:
> `privacidade@seudominio`) depois de configurar o Resend/domínio
> ([`03-email-resend.md`](./03-email-resend.md)). Enquanto não tiver domínio, um
> e-mail pessoal serve. Escolha sua.

> 🟦 **DECISÃO — Checkbox de aceite explícito vs. aceite implícito por login.**
> Recomendação default na escala de amigos: **implícito** ("ao continuar, você
> concorda com os Termos e a Política") + links visíveis. Um checkbox dedicado é
> mais defensável e vira recomendável na Fase 3. Escolha sua.

> 🟦 **DECISÃO — Identidade do controlador (seu nome pessoal vs. nome do projeto).**
> Como não há CNPJ/empresa, o controlador hoje é **você, pessoa física**.
> Recomendação default: assumir isso na Política. Constituir PJ é assunto de Fase 3.
> Escolha sua. Cruza com [`06-marca-inpi.md`](./06-marca-inpi.md) (titularidade da marca).

---

## Próximos passos / cross-links

1. Escrever e publicar `/termos` e `/privacidade` + footer (este doc).
2. Definir o e-mail de contato do controlador — depende do domínio/Resend:
   [`03-email-resend.md`](./03-email-resend.md) e [`01-dominio.md`](./01-dominio.md).
3. Avaliar registro de marca (pode esperar, mas afeta o nome que você usa nos
   Termos): [`06-marca-inpi.md`](./06-marca-inpi.md).
4. Fechar tudo no checklist de produção:
   [`07-checklist-go-live.md`](./07-checklist-go-live.md).

Relacionados no repo:
[`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md) (whitelist/convite) ·
[ADR 0004 — magic link](../decisions/0004-magic-link-auth.md) ·
[ADR 0007 — multiuser/whitelist](../decisions/0007-auth-multiuser-jwt-env-whitelist.md) ·
[ADR 0009 — whitelist em tabela DB](../decisions/0009-whitelist-db-table.md) ·
[`docs/PRD.md`](../PRD.md) · [`docs/ROADMAP.md`](../ROADMAP.md) (fases).
