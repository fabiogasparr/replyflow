import type { SeoPageConfig } from "@/components/seo-page-shell";

const templateLinks = [
  { label: "Modelo para link de produto", href: "/templates/dtc-product-link" },
  { label: "Modelo para captação imobiliária", href: "/templates/real-estate-lead-form" },
  { label: "Modelo para plano de treino", href: "/templates/fitness-plan" },
  { label: "Ver todos os modelos", href: "/templates" },
];

export const manychatAlternativePage: SeoPageConfig = {
  eyebrow: "Alternativa ao Manychat",
  title: "Uma alternativa focada ao Manychat para campanhas de comentário para DM",
  description:
    "O ReplyFlow atende equipes que não precisam de um construtor amplo de chatbot. Ele transforma comentários com palavras-chave em respostas privadas oficiais, links rastreados, métricas e relatórios para clientes.",
  primaryCta: "Experimentar o ReplyFlow",
  bullets: [
    "Feito para comentários, posts, reels e respostas privadas no Instagram.",
    "Fluxo pela API oficial da Meta, sem raspagem nem compartilhamento de senha.",
    "Modelos de campanha, links rastreados e relatórios compartilháveis.",
    "Núcleo de código aberto e SaaS gerenciado para agências.",
  ],
  sections: [
    {
      title: "Foco por escolha",
      body: "Plataformas amplas são poderosas, mas trazem o peso de construtores complexos. O ReplyFlow mantém o caminho direto: palavra-chave, post, resposta, link e resultado.",
    },
    {
      title: "Resultados para agências",
      body: "Links rastreados e relatórios compartilháveis mostram ao cliente o que aconteceu depois do comentário, além de comprovar que a mensagem foi enviada.",
    },
    {
      title: "Entrega orientada pela Meta",
      body: "Os comentários chegam por webhooks, entram em fila, são desduplicados, respeitam limites e geram respostas privadas usando o identificador oficial do comentário.",
    },
  ],
  comparisonTitle: "ReplyFlow versus construtores amplos de chatbot",
  comparisons: [
    {
      label: "Configuração",
      ours: "Crie uma campanha por palavra-chave para um post ou reel específico.",
      other: "Monte e mantenha um fluxo maior de automação de chatbot.",
    },
    {
      label: "Relatórios",
      ours: "Envios, descartes, falhas, cliques, CTR e relatórios por campanha.",
      other: "Métricas gerais de conversa que exigem tratamento para apresentar ao cliente.",
    },
    {
      label: "Posicionamento",
      ours: "Operação de campanhas do Instagram para agências e equipes.",
      other: "Automação genérica de DMs para vários canais e casos de uso.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "O ReplyFlow substitui completamente o Manychat?",
      body: "Não. O ReplyFlow é intencionalmente focado em campanhas de comentário para DM no Instagram. Para uma suíte completa de chatbot, escolha uma plataforma ampla; para ciclos rápidos de campanha, use o ReplyFlow.",
    },
    {
      title: "O produto atende agências?",
      body: "Sim. Ele oferece múltiplas contas do Instagram, integrantes, filtros, métricas e relatórios compartilháveis, com capacidade definida pelo plano.",
    },
  ],
};

export const templatesSeoPage: SeoPageConfig = {
  eyebrow: "Modelos de comentário para DM",
  title: "Modelos de campanhas para responder comentários de alta intenção",
  description:
    "Comece com padrões de campanha para produtos, materiais gratuitos, preços, listas de espera, consultorias, eventos e serviços locais.",
  primaryCta: "Usar um modelo",
  bullets: [
    "A intenção do modelo acompanha o cadastro e a criação da campanha.",
    "Cada modelo inclui palavras-chave, objetivo e sugestão de mensagem.",
    "Links rastreados transformam respostas em cliques mensuráveis.",
    "Agências podem reutilizar modelos em várias contas de clientes.",
  ],
  sections: [
    {
      title: "Links de produtos",
      body: "Use comentários como LINK, LOJA, COMPRAR ou TAMANHO para enviar páginas de produto, kits de lançamento ou coleções.",
    },
    {
      title: "Materiais gratuitos",
      body: "Use GUIA, CHECKLIST, PLANO ou COMEÇAR para entregar conteúdos gratuitos e ofertas de acompanhamento.",
    },
    {
      title: "Serviços locais",
      body: "Use PREÇO, AGENDAR, INFO ou VISITA para enviar agendamentos, orçamentos e ofertas locais.",
    },
  ],
  comparisonTitle: "Campanhas com modelo versus respostas manuais",
  comparisons: [
    {
      label: "Velocidade",
      ours: "Lance modelos reutilizáveis de campanha em poucos minutos.",
      other: "Responda manualmente ou recrie os mesmos textos a cada campanha.",
    },
    {
      label: "Medição",
      ours: "Acompanhe links e palavras-chave por campanha.",
      other: "Dependa de capturas de tela, memória da caixa de entrada ou dados dispersos.",
    },
    {
      label: "Reutilização",
      ours: "Replique o mesmo processo entre posts, reels e contas de clientes.",
      other: "Repita toda a configuração a cada campanha.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Posso editar os textos do modelo?",
      body: "Sim. Os modelos são pontos de partida. Você pode alterar palavras-chave, resposta privada, URL de destino e status antes da publicação.",
    },
    {
      title: "Os modelos funcionam com reels?",
      body: "Sim. As campanhas podem usar posts ou reels retornados pela conta profissional conectada.",
    },
  ],
};

export const agenciesSeoPage: SeoPageConfig = {
  eyebrow: "Automação de DM para agências",
  title: "Automação de DM para agências que gerenciam campanhas de clientes",
  description:
    "O ReplyFlow oferece múltiplas contas, relatórios para clientes, links rastreados e um fluxo focado de comentário para DM para campanhas recorrentes.",
  primaryCta: "Criar espaço de agência",
  bullets: [
    "Conecte várias contas de clientes no plano Agência.",
    "Filtre painel, histórico, campanhas e configurações por conta.",
    "Convide integrantes como proprietários, administradores ou membros.",
    "Compartilhe relatórios somente leitura sem expor controles internos.",
  ],
  sections: [
    {
      title: "Separação entre clientes",
      body: "Filtros por conta mantêm campanhas, histórico e relatórios organizados quando um espaço administra várias marcas.",
    },
    {
      title: "Ofertas replicáveis",
      body: "Use modelos para transformar materiais gratuitos, lançamentos, preços e produtos em serviços recorrentes da agência.",
    },
    {
      title: "Comprovação do trabalho",
      body: "Relatórios compartilháveis apresentam envios, descartes, falhas, cliques, CTR, palavras-chave e links de forma segura para o cliente.",
    },
  ],
  comparisonTitle: "Operação de agência versus automação genérica",
  comparisons: [
    {
      label: "Relatório ao cliente",
      ours: "Links públicos somente leitura, sem expor o restante do espaço de trabalho.",
      other: "Capturas manuais ou painéis que mostram contexto interno em excesso.",
    },
    {
      label: "Papéis da equipe",
      ours: "Proprietário, administrador e membro, com convites individuais.",
      other: "Um login compartilhado ou permissões maiores do que o necessário.",
    },
    {
      label: "Operação das contas",
      ours: "Filtros por conta em campanhas, histórico, métricas e configurações.",
      other: "O trabalho de diferentes clientes pode se misturar em espaços genéricos.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Quantas contas do Instagram uma agência pode conectar?",
      body: "Na configuração atual, o plano Agência comporta até dez contas profissionais conectadas.",
    },
    {
      title: "O cliente pode ver o relatório sem entrar no sistema?",
      body: "Sim. O relatório compartilhável é público e somente leitura, sem controles internos nem o texto privado das DMs.",
    },
  ],
};

export const commentLinkSeoPage: SeoPageConfig = {
  eyebrow: "Automação do comentário LINK",
  title: "Automação de comentários com palavras-chave em posts e reels",
  description:
    "Permita que seguidores comentem LINK, LOJA, GUIA ou qualquer palavra-chave e recebam a resposta privada correta com uma URL rastreada.",
  primaryCta: "Automatizar comentários",
  bullets: [
    "Identifique palavras exatas ou expressões completas.",
    "Envie respostas privadas oficiais da Meta a partir do comentário.",
    "Inclua links rastreados com métricas de cliques.",
    "Desduplique eventos e registre envios, descartes e falhas.",
  ],
  sections: [
    {
      title: "Para produtos",
      body: "Transforme comentários de alta intenção em visitas rastreadas para produtos, páginas de venda, listas de espera ou checkout.",
    },
    {
      title: "Para ofertas de criadores",
      body: "Envie guias, materiais gratuitos, cursos e formulários de consultoria sem acompanhar a caixa de entrada manualmente.",
    },
    {
      title: "Para picos de lançamento",
      body: "Coloque respostas em fila enquanto um reel ganha alcance, com limites comerciais e de envio aplicados pelo worker.",
    },
  ],
  comparisonTitle: "Automação de comentário versus envio manual de links",
  comparisons: [
    {
      label: "Precisão",
      ours: "Cada comentário compatível recebe a resposta ligada à campanha daquele post ou reel.",
      other: "Respostas manuais podem se perder quando o volume de comentários aumenta.",
    },
    {
      label: "Rastreamento",
      ours: "Links rastreados conectam respostas privadas aos cliques gerados.",
      other: "Links comuns raramente mostram desempenho por campanha.",
    },
    {
      label: "Conformidade",
      ours: "Construído sobre respostas privadas oficiais e filas atentas aos limites.",
      other: "Automação insegura do navegador ou raspagem pode colocar contas em risco.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Posso usar palavras diferentes de LINK?",
      body: "Sim. Cada campanha pode usar várias palavras, como PREÇO, LOJA, GUIA, PLANO, LISTA, VISITA ou uma expressão própria.",
    },
    {
      title: "O ReplyFlow envia uma DM comum do Instagram?",
      body: "Ele envia uma resposta privada compatível com a Meta, acionada pelo comentário e vinculada ao identificador oficial desse comentário.",
    },
  ],
};
