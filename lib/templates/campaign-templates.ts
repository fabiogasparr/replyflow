export interface CampaignTemplate {
  slug: string;
  title: string;
  category: string;
  audience: string;
  summary: string;
  goal: string;
  keywords: string[];
  dmMessage: string;
  triggerExample: string;
  privateReplyPreview: string;
  setupMinutes: number;
  outcome: string;
  bestFor: string[];
  playbook: string[];
  metrics: string[];
  accent: "cyan" | "emerald" | "rose" | "amber";
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    slug: "dtc-product-link",
    title: "Envio de link de produto",
    category: "Vendas pelas redes sociais",
    audience: "Marcas que vendem direto ao consumidor",
    summary:
      "Transforme comentários como LINK ou LOJA em uma resposta privada com a página do produto, o guia de tamanhos ou o kit de lançamento.",
    goal: "Envio de link de produto",
    keywords: ["LINK", "LOJA", "COMPRAR"],
    dmMessage:
      "Oi, {username}! Aqui está o link do produto que você pediu: https://yourstore.com/product",
    triggerExample: "LINK, por favor",
    privateReplyPreview:
      "Oi, Maya! Aqui está o link do produto que você pediu: yourstore.com/product",
    setupMinutes: 4,
    outcome: "Mais conversas com pessoas que demonstraram interesse em comprar.",
    bestFor: ["Lançamentos de produtos", "Reels feitos por clientes", "Campanhas com influenciadores"],
    playbook: [
      "Escolha um reel ou uma publicação que mostre o produto com clareza.",
      "Comece com as palavras-chave LINK, LOJA e COMPRAR.",
      "Envie o link direto do produto e uma frase curta com seu principal benefício.",
      "Acompanhe quais publicações geram mais respostas enviadas.",
    ],
    metrics: ["Respostas enviadas", "Duplicatas ignoradas", "Taxa de cliques no link do produto"],
    accent: "cyan",
  },
  {
    slug: "real-estate-lead-form",
    title: "Formulário de interesse em imóveis",
    category: "Captação de contatos",
    audience: "Corretores e imobiliárias",
    summary:
      "Envie a compradores ou vendedores um formulário de avaliação, um link de agendamento ou um guia do bairro após comentarem em um reel de imóvel.",
    goal: "Entrega de material gratuito",
    keywords: ["IMÓVEL", "VISITA", "VALOR"],
    dmMessage:
      "Oi, {username}! Preencha este formulário para receber os detalhes do imóvel e os horários disponíveis para visita: https://yourlink.com/home",
    triggerExample: "Quero saber mais sobre o IMÓVEL",
    privateReplyPreview:
      "Oi, Jordan! Aqui está o formulário para receber os detalhes do imóvel e os horários para visita.",
    setupMinutes: 5,
    outcome: "Registre o interesse pelo imóvel antes que ele se perca nos comentários.",
    bestFor: ["Reels de imóveis", "Guias de bairros", "Publicações sobre avaliação de imóveis"],
    playbook: [
      "Escolha uma publicação sobre um imóvel ou o mercado da região.",
      "Use palavras-chave que expressem o interesse do comprador.",
      "Envie um formulário que peça os dados de contato e o prazo desejado para a compra.",
      "Entre em contato com os interessados qualificados pelo formulário.",
    ],
    metrics: ["Aberturas do formulário", "Mensagens enviadas", "Visitas agendadas"],
    accent: "emerald",
  },
  {
    slug: "fitness-plan",
    title: "Download de plano de treino",
    category: "Funis para criadores",
    audience: "Treinadores e criadores de conteúdo fitness",
    summary:
      "Entregue um plano de treino, um guia de macronutrientes ou um formulário de avaliação quando seguidores comentarem PLANO, TREINO ou COMEÇAR.",
    goal: "Entrega de material gratuito",
    keywords: ["PLANO", "TREINO", "COMEÇAR"],
    dmMessage:
      "Oi, {username}! Aqui está o plano gratuito que mostrei no reel: https://yourlink.com/fitness-plan",
    triggerExample: "PLANO",
    privateReplyPreview:
      "Oi, Sam! Aqui está o plano gratuito que mostrei no reel: yourlink.com/fitness-plan",
    setupMinutes: 3,
    outcome: "Leve seguidores interessados para uma consultoria ou lista de e-mails.",
    bestFor: ["Reels de treino", "Publicações de transformação", "Lançamentos de desafios"],
    playbook: [
      "Publique um reel que mostre o resultado e peça uma palavra-chave nos comentários.",
      "Escreva uma mensagem curta, focada no material prometido.",
      "Inclua um link para avaliação da consultoria após entregar o material gratuito.",
      "Revise os registros de falhas e envios ignorados após reels com muitos acessos.",
    ],
    metrics: ["Pedidos do guia", "Inscrições no desafio", "Interesses em consultoria"],
    accent: "rose",
  },
  {
    slug: "course-webinar",
    title: "Convite para aula gratuita",
    category: "Educação",
    audience: "Produtores de cursos",
    summary:
      "Envie links de inscrição em aulas ou webinars para seguidores que comentarem WEBINAR, AULA ou APRENDER em publicações educativas.",
    goal: "Lista de espera para lançamento",
    keywords: ["WEBINAR", "AULA", "APRENDER"],
    dmMessage:
      "Oi, {username}! Aqui está o link para se inscrever na aula gratuita: https://yourlink.com/webinar",
    triggerExample: "WEBINAR",
    privateReplyPreview:
      "Oi, Alex! Aqui está o link para se inscrever na aula gratuita: yourlink.com/webinar",
    setupMinutes: 4,
    outcome: "Transforme o alcance do conteúdo educativo em inscrições para aulas e listas de espera.",
    bestFor: ["Lançamentos de cursos", "Treinamentos rápidos", "Oficinas ao vivo"],
    playbook: [
      "Vincule a campanha a um reel educativo com exemplos e resultados concretos.",
      "Use uma palavra-chave principal na legenda e cadastre duas alternativas.",
      "Envie o link de inscrição com a data ou o tema da aula.",
      "Compare os envios das publicações orgânicas antes de investir em anúncios.",
    ],
    metrics: ["Inscrições", "Mensagens enviadas", "Taxa de comparecimento"],
    accent: "amber",
  },
  {
    slug: "beauty-price-list",
    title: "Tabela de preços de serviços de beleza",
    category: "Serviços locais",
    audience: "Salões, spas e profissionais de beleza",
    summary:
      "Responda com preços, links de agendamento e a lista de serviços quando as pessoas comentarem PREÇO, SERVIÇOS ou AGENDAR.",
    goal: "Informações sobre preços e disponibilidade",
    keywords: ["PREÇO", "SERVIÇOS", "AGENDAR"],
    dmMessage:
      "Oi, {username}! Aqui estão nossos serviços e o link para agendar: https://yourlink.com/booking",
    triggerExample: "PREÇO",
    privateReplyPreview:
      "Oi, Riley! Aqui estão nossos serviços e o link para agendar.",
    setupMinutes: 4,
    outcome: "Reduza respostas repetitivas nos comentários e facilite os agendamentos.",
    bestFor: ["Reels de antes e depois", "Publicações de serviços", "Divulgação de horários disponíveis"],
    playbook: [
      "Escolha uma publicação em que as pessoas já perguntem sobre preços.",
      "Inclua um link de agendamento com categorias de serviços claras.",
      "Descreva os serviços com precisão, sem promessas médicas ou exageradas.",
      "Atualize o link quando os preços ou a disponibilidade mudarem.",
    ],
    metrics: ["Cliques no link de agendamento", "Mensagens enviadas", "Novos agendamentos"],
    accent: "rose",
  },
  {
    slug: "restaurant-menu",
    title: "Cardápio e reservas de restaurante",
    category: "Gastronomia",
    audience: "Restaurantes e cafeterias",
    summary:
      "Envie o cardápio, links de reserva ou opções especiais para eventos quando clientes comentarem CARDÁPIO, MESA ou RESERVAR.",
    goal: "Envio de link de produto",
    keywords: ["CARDÁPIO", "MESA", "RESERVAR"],
    dmMessage:
      "Oi, {username}! Aqui estão nosso cardápio e o link para fazer sua reserva: https://yourlink.com/menu",
    triggerExample: "CARDÁPIO",
    privateReplyPreview:
      "Oi, Taylor! Aqui estão nosso cardápio e o link para fazer sua reserva.",
    setupMinutes: 3,
    outcome: "Transforme reels de pratos em reservas e visitas ao cardápio.",
    bestFor: ["Pratos especiais", "Lançamentos de cardápio", "Reservas para o fim de semana"],
    playbook: [
      "Use um reel que valorize os pratos e convide as pessoas a comentar.",
      "Envie um cardápio ou uma página de reservas que funcione bem no celular.",
      "Informe a quantidade limitada de lugares apenas quando isso for verdade.",
      "Reaproveite o modelo para os pratos especiais de cada temporada.",
    ],
    metrics: ["Cliques no cardápio", "Reservas", "Respostas à campanha de fim de semana"],
    accent: "amber",
  },
  {
    slug: "event-rsvp",
    title: "Confirmação de presença em eventos",
    category: "Eventos",
    audience: "Espaços de eventos, comunidades e equipes de lançamento",
    summary:
      "Envie formulários de confirmação, links de calendário ou páginas de ingressos quando alguém comentar PRESENÇA, INGRESSO ou PARTICIPAR.",
    goal: "Lista de espera para lançamento",
    keywords: ["PRESENÇA", "INGRESSO", "PARTICIPAR"],
    dmMessage:
      "Oi, {username}! Confirme sua presença e veja os detalhes do evento neste link: https://yourlink.com/rsvp",
    triggerExample: "PRESENÇA",
    privateReplyPreview:
      "Oi, Morgan! Aqui está o link para confirmar sua presença e ver os detalhes do evento.",
    setupMinutes: 4,
    outcome: "Transforme o interesse no evento em confirmações de presença.",
    bestFor: ["Eventos temporários", "Oficinas", "Eventos de comunidades"],
    playbook: [
      "Escolha o anúncio do evento ou um reel com os melhores momentos da edição anterior.",
      "Use PRESENÇA como palavra-chave principal e adicione alternativas relacionadas a ingressos.",
      "Envie um único link com data, local e confirmação de presença.",
      "Pause a campanha quando o evento terminar.",
    ],
    metrics: ["Presenças confirmadas", "Cliques em ingressos", "Respostas por publicação do evento"],
    accent: "emerald",
  },
  {
    slug: "creator-media-kit",
    title: "Envio de mídia kit para parcerias",
    category: "Negócios para criadores",
    audience: "Criadores e agências",
    summary:
      "Envie um mídia kit, uma tabela de valores ou um formulário de parceria quando marcas comentarem PARCERIA, KIT ou VALORES.",
    goal: "Campanha para cliente de agência",
    keywords: ["PARCERIA", "KIT", "VALORES"],
    dmMessage:
      "Oi, {username}! Aqui estão meu mídia kit e o formulário para parcerias: https://yourlink.com/media-kit",
    triggerExample: "PARCERIA",
    privateReplyPreview:
      "Oi, Casey! Aqui estão meu mídia kit e o formulário para parcerias.",
    setupMinutes: 4,
    outcome: "Receba o interesse de marcas diretamente na conversa.",
    bestFor: ["Reels de portfólio fixados", "Publicações de casos de sucesso", "Prospecção de marcas"],
    playbook: [
      "Fixe uma publicação sobre parcerias ou um reel do seu portfólio.",
      "Use palavras-chave profissionais que as marcas usariam nos comentários.",
      "Envie o link do mídia kit e uma pergunta para entender o interesse da marca.",
      "Revise as mensagens toda semana e identifique as oportunidades de parceria.",
    ],
    metrics: ["Contatos de marcas", "Cliques no mídia kit", "Conversas qualificadas sobre parcerias"],
    accent: "cyan",
  },
];

export function getCampaignTemplate(slug: string | null | undefined) {
  if (!slug) return null;
  return CAMPAIGN_TEMPLATES.find((template) => template.slug === slug) ?? null;
}

export function getCampaignTemplateSlugs() {
  return CAMPAIGN_TEMPLATES.map((template) => template.slug);
}
