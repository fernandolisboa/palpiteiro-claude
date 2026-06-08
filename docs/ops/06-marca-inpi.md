# Registro de marca no INPI (avaliar/adiar)

Este doc te ajuda a decidir **se** e **quando** registrar a marca "Palpiteiro" no
INPI (Instituto Nacional da Propriedade Industrial), o órgão federal que concede
marcas no Brasil. Custo, prazo, risco de o nome ser fraco, e o que dá pra fazer
de graça **agora** vs. o que dá pra adiar com segurança.

> ⚠️ **Isto NÃO é aconselhamento jurídico.** Sou engenheiro, não advogado de
> marcas. Registro de marca tem nuance (distintividade, colidência, especificação
> de classe) que um agente da propriedade industrial avalia melhor que qualquer
> doc. Use isto pra ter contexto e tomar a decisão de **timing** — não como
> parecer legal. Para o contexto regulatório de apostas em si, ver
> [`05-legal-compliance.md`](./05-legal-compliance.md).

## TL;DR da decisão

> 🟦 **DECISÃO (sua):** registrar a marca "Palpiteiro" no INPI **agora** ou
> **depois**?
>
> **Recomendação default: ADIAR o registro formal no INPI.** Para a escala da
> Fase 2 (família e amigos, convite por whitelist — ver
> [`docs/ROADMAP.md`](../ROADMAP.md)) o risco de alguém "roubar" o nome é baixo,
> e a GRU + o tempo do processo não se pagam ainda. Deixe o INPI pra quando for
> **abrir ao público / monetizar** (Fase 3, hoje não planejada).
>
> **MAS faça já o que é barato e te dá 90% da proteção prática:**
> 1. Garanta o **domínio** (ver [`01-dominio.md`](./01-dominio.md)).
> 2. Garanta os **handles sociais** (Instagram, X, etc.) com o mesmo nome.
> 3. Comece a **guardar evidência de uso** (prints datados, primeiro deploy,
>    primeiros commits) — isso vira munição se um dia precisar disputar a marca.
>
> Isto é uma escolha sua; a recomendação acima é o caminho de menor custo/risco
> pra Fase 2, não uma obrigação.

## TL;DR da ordem (quando decidir registrar)

1. **Busca de anterioridade** — checar se "Palpiteiro" já está registrado/pedido
   na sua classe (grátis, na Busca do INPI).
2. **Avaliar distintividade** — "Palpiteiro" é evocativo; pode ser marca fraca.
   Considere registrar a versão **mista** (nome + logo) pra reforçar.
3. **Escolher classes NCL** — provavelmente **9**, **41** e/ou **42** (cada uma
   custa uma GRU separada).
4. **Cadastro no e-INPI** (login Gov.br) → **gerar e pagar a GRU** → **protocolar
   no e-Marcas**.
5. **Acompanhar a RPI** semanalmente até o deferimento (~12–18 meses).

## Por que adiar é razoável aqui

A proteção que importa de verdade pra um side project de amigos é **operacional**,
não cartorial:

| Risco | Mitigação barata (agora) | INPI ajuda? |
| --- | --- | --- |
| Alguém pega o domínio | Comprar o domínio ([`01-dominio.md`](./01-dominio.md)) | Não diretamente |
| Alguém pega @palpiteiro nas redes | Registrar os handles | Não diretamente |
| Confusão de marca com 3 amigos usando | Praticamente nulo nessa escala | Exagero |
| Concorrente registra "Palpiteiro" e te barra | Real só se você abrir ao público | **Sim** — é pra isso que serve |

Enquanto o app é solo/amigos, o último risco é remoto e — importante — a proteção
da marca, quando você registrar, **retroage à data do depósito**, não à data em
que o exame termina. Ou seja: depositar no momento em que for abrir ao público já
te cobre desde aquele dia. Você não "perde" os meses de Fase 2 por ter esperado,
desde que ninguém deposite o mesmo nome no intervalo — risco baixo pra um nome de
nicho.

## Risco de distintividade: "Palpiteiro" pode ser marca fraca

Vale entender isto sem dramatizar. A Lei da Propriedade Industrial (Lei
9.279/1996, art. 124) não registra (ou registra com proteção fraca) sinais
**meramente descritivos** do produto/serviço. "Palpite" é basicamente sinônimo
de "dica/recomendação de aposta" — exatamente o que o app faz. Então
"Palpiteiro" tende a ser visto como **evocativo/sugestivo** (no limite do
descritivo) para serviços de palpites de aposta.

Consequências práticas:

- O exame do INPI **pode** levantar exigência ou indeferir um sinal puramente
  nominativo julgado descritivo na classe de apostas/entretenimento.
- Mesmo se registrar, marca evocativa tem **proteção mais estreita**: fica difícil
  impedir terceiros de usar a palavra "palpite" genericamente.

Como mitigar (sem virar um problema agora):

- **Registrar a marca mista** (nome **+ logo/elemento gráfico** distintivo) em vez
  de só o nominativo. O conjunto fica mais distintivo e mais defensável.
- Ter um **logo próprio** desde já (mesmo simples) ajuda na hora de depositar e na
  evidência de uso.

> 💡 Isto não significa "o nome é ruim". Significa que, **se** você for ao INPI,
> vale ir com logo e não só com a palavra solta — e calibrar a expectativa de que
> a proteção do nome puro é limitada.

## Busca de anterioridade (grátis, faça já)

Antes de qualquer decisão, veja se o caminho está livre. Tudo grátis:

1. **Busca de Marcas do INPI** — a base oficial de pedidos e registros:
   [busca.inpi.gov.br/pePI](https://busca.inpi.gov.br/pePI/jsp/marcas/Pesquisa_classe_basica.jsp).
   Busque "PALPITEIRO" (e variações: "PALPITEIRA", "PALPITE", radicais) e filtre
   pelas classes que te interessam (9, 41, 42). Procure marcas **iguais ou
   parecidas na mesma classe** — colidência é o motivo nº 1 de indeferimento.
2. **Domínio** — cheque a disponibilidade do `.com.br`/`.com`/`.app` em paralelo
   (ver [`01-dominio.md`](./01-dominio.md)). Marca registrada e domínio são coisas
   separadas, mas você quer os dois alinhados.
3. **Redes sociais** — confira se os handles `@palpiteiro` estão livres no
   Instagram, X, TikTok, etc. Mesmo adiando o INPI, **registre os handles agora**
   (é grátis e some rápido).

> ⚠️ Disponibilidade na Busca do INPI **hoje** não garante registro: alguém pode
> depositar amanhã, ou o examinador pode achar a marca descritiva. Mas um conflito
> óbvio já visível na busca é motivo pra repensar o nome **antes** de gastar a GRU.

## Classes NCL prováveis

O Brasil usa a **Classificação de Nice (NCL)**. Cada pedido cobre **uma classe**;
proteger em várias classes = **uma GRU por classe** (custo multiplica). Para um
app de software com recomendações e tracking, as candidatas são:

| Classe | Cobre | Encaixe no Palpiteiro |
| --- | --- | --- |
| **9** | Software como **produto** baixável (apps que você instala) | App/PWA instalável; provável se houver app de loja |
| **41** | Educação, **entretenimento**, atividades esportivas e culturais | Conteúdo de palpites/entretenimento esportivo |
| **42** | Serviços científicos e tecnológicos; **SaaS**, desenvolvimento de software | App web entregue como serviço (o caso mais direto hoje) |

Regra prática da distinção 9 vs 42: **software-produto** (instalável) → classe 9;
**software-serviço** (acessado online, SaaS) → classe 42. O Palpiteiro hoje é um
web app (SaaS), então **42** é a classe mais aderente; **41** entra se você
enquadrar o conteúdo como entretenimento; **9** entra se virar app de loja.

> ⚠️ **Cuidado com a especificação de "apostas".** O INPI tem regra específica
> (procedimento de mai/2025) para marcas de **apostas esportivas / jogos**: itens
> como "apostas esportivas" só são aceitos de **pessoa jurídica** que **declare o
> exercício lícito e efetivo** da atividade (Lei 14.790/2023); **pessoa física
> não** pode reivindicar esses itens. Mas o **Palpiteiro não opera apostas** — ele
> gera recomendações e faz tracking (ver [`05-legal-compliance.md`](./05-legal-compliance.md)).
> Então a sua especificação deve descrever **software/SaaS/entretenimento e
> informação esportiva**, e **não** "serviços de apostas". Isso te mantém fora da
> exigência de declarar-se operador de apostas — que você não é.
> Fonte: [INPI — análise de pedidos relativos a jogos de azar ou apostas](https://www.gov.br/inpi/pt-br/central-de-conteudo/noticias/alteracao-de-procedimento-na-analise-de-pedidos-de-marca-relativos-a-jogos-de-azar-ou-apostas).

> 🟦 **DECISÃO (sua):** quantas classes registrar. Default: **1 classe (42)** se e
> quando registrar, pra minimizar custo; adicione **41** (e **9** se houver app de
> loja) só se quiser cobertura ampla. Cada classe extra = outra GRU.

## Custo: a GRU do INPI

O custo é pago via **GRU (Guia de Recolhimento da União)**, gerada no sistema do
INPI. Há **dois serviços de depósito** com preços diferentes, e cada um tem
**valor cheio** e **valor reduzido** (desconto de **50%**).

**Quem tem direito ao desconto de 50%:** pessoa física (desde que não tenha
participação em empresa do ramo do item registrado), MEI, microempresa (ME) e
empresa de pequeno porte (EPP), além de ICTs, entidades sem fins lucrativos e
órgãos públicos. Como side project solo, você (pessoa física ou MEI) quase certo
se enquadra no reduzido — **confirme seu enquadramento ao gerar a GRU.**

Valores **por classe** (estimativa atual, pós-reajuste de **20/09/2025** —
**valores mudam, confira sempre na fonte oficial**):

| Serviço (depósito) | Valor cheio | Reduzido (−50%) | Quando usar |
| --- | --- | --- | --- |
| **Cód. 389** — especificação da **lista pré-aprovada** do INPI | ~R$ 880 | ~R$ 440 | Você escolhe itens da lista pronta do INPI (mais barato, mais simples) |
| **Cód. 394** — especificação de **livre preenchimento** | ~R$ 1.720 | ~R$ 860 | Você redige a especificação à mão (mais caro; use só se a lista não cobre) |

Além do depósito, há a fase de **concessão / 1ª década** ao final, **se** a marca
for deferida:

- A **emissão do certificado** passou a ser **gratuita e automática** após a
  reforma de set/2025 (antes era um pagamento à parte).
- A **1ª década** (vigência de 10 anos) tem retribuição própria — estimativa na
  faixa de **~R$ 375 reduzido** após ago/2025 — **confira na tabela oficial
  (valores mudam)**.

> ⚠️ **Estes números mudam.** O INPI reajustou a tabela em **ago/2025** e de novo
> em **20/09/2025**; pode reajustar de novo. **Sempre** confira o valor vigente
> antes de pagar:
> - Tabela de retribuições e custos:
>   [gov.br/inpi → Marcas → Custos](https://www.gov.br/inpi/pt-br/servicos/marcas/custos)
> - Guia básico de marcas:
>   [gov.br/inpi → Marcas → Guia Básico](https://www.gov.br/inpi/pt-br/servicos/marcas/guia-basico)

### DIY (Gov.br/INPI) vs. contratar agente

| Opção | Custo aprox. | Quando faz sentido |
| --- | --- | --- |
| **DIY** via e-INPI/e-Marcas | só a(s) GRU(s) | Marca simples, sem conflito óbvio, você topa acompanhar a RPI e responder exigências |
| **Agente / advogado de marcas** | GRU + honorários (centenas a alguns milhares de R$) | Marca com risco de exigência (ex.: distintividade fraca como "Palpiteiro"), ou quando o custo do erro/indeferimento pesa |

Para a Fase 2 (adiando o registro), nada disso é necessário ainda. **Se/quando**
registrar e o ponto de distintividade preocupar, um agente reduz o risco de
indeferir e perder a GRU.

## Como protocolar (quando decidir ir)

Resumo do fluxo oficial — detalhes no
[Guia Básico do INPI](https://www.gov.br/inpi/pt-br/servicos/marcas/guia-basico):

1. **Busca de anterioridade** em [busca.inpi.gov.br/pePI](https://busca.inpi.gov.br/pePI/jsp/marcas/Pesquisa_classe_basica.jsp)
   (ver seção acima).
2. **Cadastro no e-INPI** com login **Gov.br** (cria o acesso aos serviços de
   marcas).
3. **Gerar e pagar a GRU** do serviço de depósito (cód. 389 ou 394), por classe.
4. **Protocolar no e-Marcas** usando o número da GRU paga: defina a **natureza**
   (nominativa / figurativa / **mista** / tridimensional), a classe **NCL** e a
   **especificação** de produtos/serviços.
5. **Acompanhar a RPI** (Revista da Propriedade Industrial, publicada toda
   terça) pelo número do processo, e responder qualquer **exigência** no prazo.

## Timeline

- **~12 a 18 meses** do depósito até o deferimento para pedidos **sem oposição**
  (mais, ~22 meses, se houver oposição). É processo lento; planeje com folga.
- **A proteção retroage à data do depósito** — então o que conta é **quando você
  deposita**, não quando sai a concessão. Depositar no momento de abrir ao público
  já cobre você desde aquele dia.
- Marca registrada vale **10 anos** e é **renovável** indefinidamente por períodos
  de 10 anos.

## Recomendação final

| Quando | O que fazer | Custo |
| --- | --- | --- |
| **Agora (Fase 1/2)** | Comprar **domínio** + registrar **handles** sociais + guardar **evidência de uso** (prints datados, data do 1º deploy, commits) | Só o domínio (ver [`01-dominio.md`](./01-dominio.md)); handles grátis |
| **Antes de abrir ao público / monetizar (Fase 3)** | Fazer busca de anterioridade séria, definir classe(s), depositar a marca **mista** (nome + logo) no INPI | GRU por classe (ver tabela acima) + agente opcional |

Resumo: **não gaste GRU agora.** Trave o nome no lugar que importa hoje (domínio +
redes), documente que você usa o nome desde tal data, e leve o INPI pro checklist
de "abrir ao público". Se a distintividade fraca de "Palpiteiro" te incomodar,
essa é a hora de avaliar um nome/logo mais distintivo — barato de trocar agora,
caro de trocar depois.

## Próximos passos e cross-links

- [ ] Rodar a **busca de anterioridade** de "Palpiteiro" na Busca do INPI (grátis,
      5 min) — só pra saber se há conflito óbvio.
- [ ] Garantir **domínio** e **handles sociais** com o nome escolhido →
      [`01-dominio.md`](./01-dominio.md).
- [ ] Começar a **guardar evidência de uso** (print do app com data, link do 1º
      deploy, primeiros commits).
- [ ] **Adiar** o depósito formal no INPI; adicioná-lo ao
      [`07-checklist-go-live.md`](./07-checklist-go-live.md) como item de Fase 3
      (abrir ao público).
- [ ] Decidir nome **definitivo** antes de qualquer registro — ainda em aberto
      (ver [`01-dominio.md`](./01-dominio.md)).

**Cross-links:**
[`01-dominio.md`](./01-dominio.md) ·
[`05-legal-compliance.md`](./05-legal-compliance.md) ·
[`07-checklist-go-live.md`](./07-checklist-go-live.md) ·
índice em [`README.md`](./README.md)

**Fontes oficiais (valores e regras mudam — confira sempre):**
[INPI — Guia Básico de Marcas](https://www.gov.br/inpi/pt-br/servicos/marcas/guia-basico) ·
[INPI — Custos / Tabela de Retribuições](https://www.gov.br/inpi/pt-br/servicos/marcas/custos) ·
[INPI — Busca de Marcas (pePI)](https://busca.inpi.gov.br/pePI/jsp/marcas/Pesquisa_classe_basica.jsp) ·
[INPI — análise de pedidos relativos a jogos/apostas](https://www.gov.br/inpi/pt-br/central-de-conteudo/noticias/alteracao-de-procedimento-na-analise-de-pedidos-de-marca-relativos-a-jogos-de-azar-ou-apostas) ·
[Manual de Marcas do INPI](https://manualdemarcas.inpi.gov.br/)
