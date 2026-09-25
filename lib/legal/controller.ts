// Identificação do controlador (LGPD art. 9º, III-IV) e do fornecedor nos Termos — fonte
// única pras páginas legais (/termos, /privacidade), o footer e o /perfil. Ver ADR 0047 e
// docs/reports/11-revisao-legal.md.
//
// SLOT DO DONO: `CONTROLLER_LEGAL_NAME` fica `null` até o dono decidir publicar o nome
// civil (ato que só ele pode praticar — report 11, "ações que só o dono pode executar").
// Com `null`, as páginas dizem que o controlador é a pessoa física que mantém o projeto e
// que a identificação completa é informada pelo canal de contato. Ao preencher, bump a
// "Última atualização" de /termos e /privacidade (forward-only).
//
// NUNCA inventar nome/CPF/CNPJ aqui. Quando houver MEI/CNPJ (monetização — Decreto
// 7.962/2013 art. 2º passa a exigir nome, CPF/CNPJ e endereço), acrescentar os campos.
export const CONTROLLER_LEGAL_NAME: string | null = null;

// Canal de comunicação com o titular (LGPD art. 9º, IV; Res. CD/ANPD nº 2/2022 art. 11 —
// dispensa de encarregado exige canal). PRECISA receber e-mail de verdade: é o mesmo
// endereço do RESEND_FROM_EMAIL (envio), então a caixa de ENTRADA depende de roteamento
// inbound configurado pelo dono (report 11, ação do dono nº 1).
export const LEGAL_CONTACT_EMAIL = "contato@palpiteiro.live";

// Prazo (dias corridos) que o Palpiteiro assume pra responder pedidos do titular. É o
// prazo do art. 19, II da LGPD (declaração completa em até 15 dias) — adotamos ele como
// teto pra TODO pedido, sem usar o prazo em dobro da Res. CD/ANPD nº 2/2022 art. 14.
export const DATA_REQUEST_RESPONSE_DAYS = 15;

/** Frase de identificação do controlador, com ou sem o nome civil preenchido. */
export function controllerIdentification(): string {
  return CONTROLLER_LEGAL_NAME
    ? `${CONTROLLER_LEGAL_NAME}, pessoa física, que mantém o Palpiteiro como projeto pessoal`
    : "a pessoa física que mantém o Palpiteiro como projeto pessoal, sem empresa constituída";
}
