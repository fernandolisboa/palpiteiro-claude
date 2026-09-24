# ADR 0041 — Envelope regulatório: ferramenta de análise não-operadora, sem vínculo, link ou publicidade de casa de apostas

## Status

Accepted (2026-09-24). Decisão de revisão legal delegada pelo dono (report
[11](../reports/11-revisao-legal.md)). Formaliza o "NÃO duro" a afiliado de casa que o
Report 07 rec. 7 pedia como ADR, e fixa os gatilhos que obrigam a reabrir a análise legal
(monetização). Sem código novo: registra invariantes que o produto já cumpre.

## Contexto

- O Palpiteiro gera análises/palpites sobre partidas e deixa o usuário **registrar as
  próprias apostas** (hipotéticas, em unidades). Não recebe aposta, não define quota, não
  paga prêmio, não movimenta dinheiro, não cobra, não exibe anúncio.
- **Lei 14.790/2023** *(verificado na fonte)*:
  - art. 2º define **agente operador** como a pessoa jurídica autorizada pelo Ministério da
    Fazenda a explorar apostas de quota fixa, e **aposta** como o ato de colocar valor em
    risco pra obter prêmio. O Palpiteiro não é nenhum dos dois papéis.
  - art. 16 remete publicidade de apostas à regulamentação do MF e manda avisos de
    desestímulo/prevenção e proteção de menores; art. 17 **caput** veda condutas
    publicitárias **ao agente operador** (anunciar operador não autorizado, afirmações
    infundadas sobre probabilidade de ganhar, associar aposta a sucesso pessoal, sugerir
    aposta como alternativa de emprego/solução financeira, marketing dirigido a menores);
    §§ 2º-6º obrigam provedores/plataformas a remover publicidade irregular após notificação.
  - art. 26, I veda aposta por menor de 18 anos.
  - **art. 40, III**: é infração de **qualquer pessoa** fazer, direta ou indiretamente,
    publicidade ou propaganda de apostas não autorizadas. **Este é o único dispositivo da
    lei que alcança diretamente um não-operador como nós.**
- **Portaria SPA/MF nº 1.231/2024** (jogo responsável e publicidade) aplica-se a agentes
  operadores e aos seus **afiliados** — definidos como quem faz publicidade do operador
  mediante remuneração (inclusive não monetária) atrelada a resultado; o operador responde
  solidariamente (art. 21). Não trata de tipster/produtor de conteúdo não contratado.
  *(verificado em fonte secundária — artigo do escritório Baptista Luz —, não no DOU)*
- **CONAR, Anexo X** (publicidade de apostas, dez/2023) é autorregulação de **publicidade
  comercial** de apostas. *(não verificado — conferir depois)*
- **CDC** (Lei 8.078/1990): art. 3º, § 2º exige remuneração pra caracterizar serviço de
  consumo; arts. 25 e 51, I tornam nulas cláusulas que exoneram/atenuam responsabilidade
  do fornecedor; art. 37 veda publicidade enganosa. *(não verificado — conferir depois)*
- **Marco Civil** (Lei 12.965/2014), art. 15: guarda obrigatória de registros de acesso
  (data/hora + IP, art. 5º, VIII) por 6 meses só pra provedor de aplicação **constituído
  como pessoa jurídica**, organizado, profissional e **com fins econômicos**.
  *(verificado na fonte)*

## Decisão

**1. Enquadramento.** O Palpiteiro é **ferramenta informativa de análise**, não agente
operador (Lei 14.790, art. 2º) e não afiliado (Portaria 1.231). Não precisa de
autorização da SPA nem de domínio `.bet.br`. A Portaria 1.231 e o art. 17 da Lei 14.790
**não se aplicam diretamente**; adotamos voluntariamente o núcleo deles (Decisão 4).

**2. Vedação dura (invariante de produto).** Nenhuma superfície do app — autenticada ou
pública (`/`, `/como-funciona`, `/p/[id]`, OG images, e-mails) — pode ter:
link, botão, banner, cupom, código de afiliado, deep-link ou CTA pra casa de apostas;
publicidade de terceiros (inclusive rede programática, que pode servir anúncio de bet);
patrocínio de operador; qualquer remuneração ligada a casa. Motivo: o primeiro link ou
comissão nos torna **afiliado** (Portaria 1.231) e expõe ao **art. 40, III** se a casa não
for autorizada — e destrói a defesa de não-operador que mantém a carga regulatória perto
de zero. Reabrir exige ADR novo que supere este (Decisão 6).

**3. Nome de casa como fonte de cotação — risco aceito, com limites.** O app mostra o
nome da casa de onde veio a cotação de referência (`components/odds-card.tsx:113`,
`components/analysis-result.tsx:140`, `components/dashboard/prediction-detail.tsx:94`), e
a fonte (The Odds API, região `eu`, `lib/providers/odds-api.ts:32`) inclui casas **sem
autorização no Brasil**. Leitura: atribuição de dado, sem link, sem chamada à ação, em área
autenticada — não é "publicidade ou propaganda" (art. 40, III). Limites vinculantes: o
nome da casa **nunca** vai pra superfície pública (o firewall do `/p`, ADR 0035 §5, já
exclui odds) e **nunca** vira link. Os Termos §5 dizem que o nome é só a fonte do dado.

**4. Regras de conteúdo adotadas voluntariamente** (espelham Lei 14.790 art. 16-17 e as
mensagens de jogo responsável), já implementadas e agora invariantes:
- sem promessa de acerto, lucro ou retorno; sem "% de acerto"/ROI de marketing;
  desempenho só como histórico verificável e com "passado não garante futuro";
- aposta nunca apresentada como renda, investimento ou solução financeira ("Aposta não é
  investimento": footer, Termos §4, disclaimers);
- 18+ em toda página (footer global), autodeclaração obrigatória no cadastro;
- avisos de risco na análise (`lib/view/analysis.ts:44`), na aposta livre / "analise minha
  aposta" / histórico (`components/free-bet.tsx:32`, `components/grade-my-bet.tsx:18`,
  `app/apostas/page.tsx:32`) e no público (`lib/view/share/disclaimer.ts`);
- canais de ajuda (CVV 188, Jogadores Anônimos) no footer, Termos e `/p`;
- orientação a apostar só em casa autorizada (`.bet.br`) e a não usar o app em
  autoexclusão (Termos §1, §9).

**5. Gate 18+ = autodeclaração.** Sem verificação documental: não operamos aposta (o art.
26, I obriga operador/apostador), não coletamos documento (minimização, LGPD art. 6º,
III). Reavaliar se o app ficar público em escala.

**6. Gatilhos que reabrem a análise legal (antes de executar, não depois).**
- **Cobrar qualquer coisa** (assinatura, créditos): vira relação de consumo (CDC) → a
  limitação de responsabilidade dos Termos §10 precisa ser reescrita (arts. 25/51, I);
  Decreto 7.962/2013 art. 2º passa a exigir nome, CPF/CNPJ e endereço físico e eletrônico
  na página *(não verificado — conferir depois)*; emissão de nota → MEI/CNPJ; política de
  cancelamento/arrependimento (CDC art. 49 — *não verificado*).
- **Constituir PJ e ter fins econômicos**: Marco Civil art. 15 → guardar registros de
  acesso (IP + data/hora) por 6 meses, sob sigilo — os logs da Vercel não cobrem esse
  prazo; exigirá tabela/serviço próprio de access log.
- **Receber doação**: permitido sem reabrir (sem contraprestação, sem relação de consumo),
  desde que o link fique longe de recomendação e nunca vinculado a "picks".
- **Qualquer vínculo com casa** (Decisão 2): proibido; reabrir só com ADR novo.
- **Crescer além de amigos / perfilar usuários**: reavaliar alto risco (Res. CD/ANPD 2/2022
  art. 4º) e a dispensa de encarregado (ADR 0040 Decisão 8).

## Alternativas consideradas e rejeitadas

1. **Afiliado de casa `.bet.br` licenciada** — rejeitado agora: torna o app afiliado
   (Portaria 1.231, responsabilidade solidária do operador e todo o regime de publicidade),
   receita incompatível com a escala e contradição de marca (Report 07/08).
2. **Esconder o nome da casa nas cotações** — rejeitado por ora: perde transparência da
   análise (overround/fonte) pra mitigar um risco baixo; revisitar se a fonte de odds
   mudar pra casas `.bet.br` ou se algum nome tiver de ir pra superfície pública.

## Consequências

- Agentes/sessões futuras não adicionam link/ad/afiliado "casualmente": este ADR é o
  bloqueio explícito.
- Monetização tem checklist legal pronto (Decisão 6).

## Citações não verificadas nesta sessão

CONAR Anexo X; CDC arts. 3º § 2º, 25, 37, 49, 51 I; Decreto 7.962/2013 art. 2º; LGPD art. 6º,
III (texto). Portaria SPA/MF 1.231/2024 conferida só em fonte secundária.
