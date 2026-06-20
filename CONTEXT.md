# CONTEXT.md — Glossário

Glossário do domínio do Palpiteiro: o vocabulário compartilhado do produto. Só termos e definições — sem decisões, sem implementação, sem caminhos de arquivo (essas coisas vivem nos ADRs em `docs/decisions/`).

- **Palpite (manchete / HERO):** a previsão sintetizada do resultado do jogo (veredito + placar provável + confiança + narrativa), gerada com o máximo de informação (dados + análises/EV + notícias), **value-aware**, **settleable** (badge acertou/errou) e **falível** — entretenimento/previsão informada, com rótulo "não é recomendação de aposta", NUNCA conselho de aposta. Não carrega número nem linguagem de valor.

- **Análise / Recomendação (de mercado):** a análise por mercado com edge/EV/stake/odd e racional — a camada informativa sóbria onde números de valor são legítimos.

- **Lucro esperado / Retorno esperado (EV):** o retorno esperado de uma seleção de mercado; vive na Análise; é insumo de **decisão** do palpite; nunca exibido na manchete.

- **Linguagem de valor:** edge / EV / stake / odd / retorno / lucro / yield / cotação / R$ — barrada na manchete (firewall), legítima na Análise.

- **Fonte de notícia:** uma fonte real e verificável (título + URL) que informou o palpite, exibida como link clicável; nunca inventada pela LLM.

- **Palpite compartilhado (snapshot público):** a versão pública, read-only e imutável de um palpite — manchete-only (veredito + placar provável + confiança + narrativa + times + mercados citados + fontes), SEM odds/EV/edge/stake nem proveniência; a imagem que circula no zap/redes quando o usuário escolhe compartilhar. Opt-in por palpite, anônima, com disclaimer e firewall de linguagem de valor herdados da manchete. Primeira superfície pública de conteúdo além da landing estática.
