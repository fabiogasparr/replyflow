import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import { PRODUCT } from "@/lib/product";

export const metadata: Metadata = {
  title: "Comentários que viram conversas",
  description: PRODUCT.description,
};

const flowSteps = [
  {
    number: "01",
    title: "Conecte sua conta",
    description:
      "Autorize uma conta profissional do Instagram pela API oficial da Meta. Sem compartilhar senha e sem automação de navegador.",
  },
  {
    number: "02",
    title: "Desenhe a resposta",
    description:
      "Escolha o post, defina palavras-chave e escreva a mensagem que será entregue quando a intenção aparecer.",
  },
  {
    number: "03",
    title: "Acompanhe a conversa",
    description:
      "Cada envio entra na fila, respeita limites da conta e deixa um histórico claro para sua equipe acompanhar.",
  },
];

const capabilities = [
  {
    eyebrow: "Captura confiável",
    title: "Webhook rápido. Varredura de segurança.",
    description:
      "O ReplyFlow recebe comentários em tempo real e também reconcilia eventos que a plataforma não entregou, reduzindo oportunidades perdidas.",
    accent: "coral",
  },
  {
    eyebrow: "Caixa de entrada",
    title: "A conversa continua no mesmo lugar.",
    description:
      "Leia e responda mensagens do Instagram com contexto, dentro da janela oficial de atendimento da Meta.",
    accent: "yellow",
  },
  {
    eyebrow: "Operação multiempresa",
    title: "Contas e equipes sem dados misturados.",
    description:
      "Organize marcas e clientes por espaço de trabalho, com isolamento de dados e convites para a equipe.",
    accent: "green",
  },
  {
    eyebrow: "Decisão por dados",
    title: "Do comentário ao clique, tudo rastreável.",
    description:
      "Acompanhe envios, falhas, cliques e desempenho das campanhas para repetir o que realmente gera conversa.",
    accent: "cream",
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2">
      <path d="M4 10h12m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto max-w-[620px] lg:mx-0">
      <div className="absolute -left-5 top-12 h-20 w-20 rounded-full bg-[#f5c451] sm:-left-10 sm:h-28 sm:w-28" aria-hidden="true" />
      <div className="absolute -bottom-5 -right-3 h-24 w-24 rounded-[28px] border-[12px] border-[#ff6b4a] sm:-right-8" aria-hidden="true" />

      <div className="relative overflow-hidden rounded-[24px] border border-[#315047] bg-[#112620] p-3 shadow-[0_30px_90px_rgba(17,38,32,0.28)] sm:p-5">
        <div className="flex items-center justify-between border-b border-white/10 px-2 pb-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b4a]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f5c451]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#72b69d]" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#86a198]">
            Automação ativa
          </span>
        </div>

        <div className="grid gap-3 pt-4 sm:grid-cols-[1fr_0.92fr]">
          <div className="rounded-2xl bg-[#f7f2e8] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6c7873]">
                  Campanha
                </p>
                <h3 className="mt-1 text-sm font-extrabold text-[#112620]">Catálogo de inverno</h3>
              </div>
              <span className="rounded-full bg-[#dff1e9] px-2 py-1 text-[10px] font-bold text-[#1d6a53]">
                Ativa
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-[#ded5c6] bg-white p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#84908b]">
                  Quando alguém comentar
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["QUERO", "CATÁLOGO", "LINK"].map((keyword) => (
                    <span key={keyword} className="rounded-md bg-[#112620] px-2 py-1 text-[9px] font-bold text-white">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex justify-center text-[#8b9691]" aria-hidden="true">↓</div>

              <div className="rounded-xl border border-[#ffc6b8] bg-[#fff0eb] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#b7442d]">
                  Enviar mensagem privada
                </p>
                <p className="mt-2 text-xs leading-5 text-[#33463f]">
                  Oi! Separei o catálogo completo para você. Toque no botão para abrir ↓
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-[#f5c451] text-xs font-black text-[#112620]">LM</div>
                <div>
                  <p className="text-xs font-bold text-[#112620]">@loja.maria</p>
                  <p className="text-[10px] text-[#76827d]">agora mesmo</p>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-[#f3eee4] px-3 py-2.5 text-xs text-[#33463f]">
                Quero o catálogo! ✨
              </p>
              <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-[#1d7a5d]">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#dff1e9]">✓</span>
                Regra encontrada e enviada
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#86a198]">
                Hoje
              </p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-black tracking-[-0.04em]">148</p>
                  <p className="mt-1 text-[10px] text-[#b8c7c1]">conversas iniciadas</p>
                </div>
                <svg viewBox="0 0 100 46" className="h-12 w-28" aria-hidden="true">
                  <polyline points="1,39 17,31 33,34 49,18 65,23 82,10 99,4" fill="none" stroke="#f5c451" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative -mt-4 ml-auto mr-4 flex w-fit items-center gap-2 rounded-full border border-[#e1d6c7] bg-white px-4 py-2 text-xs font-bold text-[#112620] shadow-[0_12px_35px_rgba(17,38,32,0.12)] sm:mr-10">
        <span className="h-2 w-2 rounded-full bg-[#1d7a5d]" />
        Fila processando normalmente
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#fbf8f2] text-[#112620]">
      <header className="sticky top-0 z-40 border-b border-[#ded5c6] bg-[#fbf8f2]/95">
        <div className="mx-auto flex h-[72px] w-full max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <BrandMark />

          <nav className="hidden items-center gap-7 md:flex" aria-label="Navegação principal">
            <a href="#como-funciona" className="text-sm font-semibold text-[#5c6b65] transition hover:text-[#112620]">
              Como funciona
            </a>
            <a href="#recursos" className="text-sm font-semibold text-[#5c6b65] transition hover:text-[#112620]">
              Recursos
            </a>
            <a href="#seguranca" className="text-sm font-semibold text-[#5c6b65] transition hover:text-[#112620]">
              Segurança
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden px-3 py-2 text-sm font-bold text-[#44534d] transition hover:text-[#112620] sm:inline-flex">
              Entrar
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-[#112620] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d3b32]">
              Começar
              <ArrowIcon />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative border-b border-[#ded5c6]">
        <div className="brand-grid absolute inset-0 opacity-35" aria-hidden="true" />
        <div className="absolute inset-0 bg-[#fbf8f2]/80" aria-hidden="true" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:px-8 lg:pb-28 lg:pt-24">
          <div className="max-w-2xl">
            <div className="replyflow-rise inline-flex items-center gap-2 rounded-full border border-[#d8cdbd] bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[#53625c]">
              <span className="h-2 w-2 rounded-full bg-[#ff6b4a]" />
              Automação para Instagram · API oficial Meta
            </div>

            <h1 className="replyflow-rise replyflow-rise-delay-1 font-display mt-7 text-[3.3rem] font-bold leading-[0.98] tracking-[-0.055em] text-[#112620] sm:text-7xl lg:text-[5.1rem]">
              Faça o comentário virar conversa antes que a intenção esfrie.
            </h1>

            <p className="replyflow-rise replyflow-rise-delay-2 mt-7 max-w-xl text-base leading-7 text-[#5c6b65] sm:text-lg sm:leading-8">
              O ReplyFlow identifica palavras-chave nos seus posts, envia a mensagem certa e mostra o que aconteceu — para sua equipe vender sem deixar ninguém esperando.
            </p>

            <div className="replyflow-rise replyflow-rise-delay-2 mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff6b4a] px-6 py-3.5 text-sm font-black text-white shadow-[0_8px_0_#c9472e] transition hover:-translate-y-0.5 hover:bg-[#f45e3d]">
                Criar minha primeira automação
                <ArrowIcon />
              </Link>
              <a href="#como-funciona" className="inline-flex items-center justify-center rounded-xl border border-[#cfc3b3] bg-white px-6 py-3.5 text-sm font-bold text-[#112620] transition hover:border-[#112620]">
                Ver como funciona
              </a>
            </div>

            <dl className="mt-11 grid max-w-xl grid-cols-3 border-y border-[#d8cdbd] py-5">
              {[
                ["24h", "de operação"],
                ["100%", "dos eventos rastreados"],
                ["0", "senhas do Instagram"],
              ].map(([value, label]) => (
                <div key={label} className="border-r border-[#d8cdbd] px-3 first:pl-0 last:border-0 sm:px-5">
                  <dt className="text-2xl font-black tracking-[-0.04em] sm:text-3xl">{value}</dt>
                  <dd className="mt-1 text-[10px] leading-4 text-[#6b7873] sm:text-xs">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="bg-[#112620] py-5 text-white" aria-label="Benefícios principais">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-x-7 gap-y-3 px-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#c4d1cc] sm:px-6 lg:px-8">
          {[
            "Resposta automática",
            "Fila com retentativas",
            "Múltiplas contas",
            "Links rastreáveis",
            "Relatórios claros",
          ].map((item, index) => (
            <span key={item} className="flex items-center gap-7">
              {index > 0 && <span className="text-[#ff6b4a]" aria-hidden="true">✦</span>}
              {item}
            </span>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#e65336]">Como funciona</p>
            <h2 className="font-display mt-4 text-4xl font-bold leading-[1.04] tracking-[-0.045em] sm:text-5xl">
              Três passos entre a curiosidade e a conversa.
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-[#66736e]">
              Você define a estratégia. A infraestrutura garante que a mensagem chegue com segurança e histórico.
            </p>
          </div>

          <div className="divide-y divide-[#d8cdbd] border-y border-[#d8cdbd]">
            {flowSteps.map((step) => (
              <article key={step.number} className="grid gap-3 py-6 sm:grid-cols-[64px_0.8fr_1.2fr] sm:items-start sm:gap-6 sm:py-7">
                <span className="text-sm font-black text-[#ff6b4a]">{step.number}</span>
                <h3 className="text-lg font-extrabold tracking-[-0.02em]">{step.title}</h3>
                <p className="text-sm leading-6 text-[#66736e]">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="recursos" className="border-y border-[#ded5c6] bg-[#f3eee4] py-20 lg:py-28">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#e65336]">O centro da operação</p>
            <h2 className="font-display mt-4 text-4xl font-bold leading-[1.04] tracking-[-0.045em] sm:text-6xl">
              Menos ferramenta para configurar. Mais conversa para conduzir.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {capabilities.map((capability, index) => {
              const styles = {
                coral: "bg-[#ff6b4a] text-white border-[#d84c2f]",
                yellow: "bg-[#f5c451] text-[#112620] border-[#d3a63d]",
                green: "bg-[#1d5a48] text-white border-[#174738]",
                cream: "bg-[#fbf8f2] text-[#112620] border-[#d8cdbd]",
              }[capability.accent];

              return (
                <article key={capability.title} className={`min-h-[270px] rounded-[24px] border p-6 sm:p-8 ${styles} ${index === 0 ? "md:col-span-2 md:grid md:grid-cols-2 md:gap-12" : ""}`}>
                  <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${capability.accent === "coral" || capability.accent === "green" ? "text-white/70" : "text-[#5d655f]"}`}>
                    {capability.eyebrow}
                  </p>
                  <div className={index === 0 ? "md:col-start-2" : ""}>
                    <h3 className="font-display mt-8 text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl">{capability.title}</h3>
                    <p className={`mt-5 max-w-xl text-sm leading-6 ${capability.accent === "coral" || capability.accent === "green" ? "text-white/80" : "text-[#586660]"}`}>
                      {capability.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="seguranca" className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-28">
        <div className="relative min-h-[390px] overflow-hidden rounded-[28px] bg-[#112620] p-7 text-white sm:p-10">
          <div className="brand-grid absolute inset-0 opacity-[0.06]" aria-hidden="true" />
          <div className="relative flex h-full min-h-[310px] flex-col justify-between">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f5c451] text-[#112620]">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-none stroke-current stroke-[1.8]">
                <path d="M12 3 5 6v5c0 4.7 2.8 8.3 7 10 4.2-1.7 7-5.3 7-10V6l-7-3Z" strokeLinejoin="round" />
                <path d="m9 12 2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-5xl font-black tracking-[-0.055em] sm:text-6xl">API oficial.</p>
              <p className="mt-2 text-5xl font-black tracking-[-0.055em] text-[#86a198] sm:text-6xl">Sem atalhos.</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#e65336]">Segurança desde a base</p>
          <h2 className="font-display mt-4 text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
            A reputação da sua conta não é campo para improviso.
          </h2>
          <p className="mt-6 text-base leading-7 text-[#66736e]">
            O ReplyFlow usa os fluxos oficiais da Meta, criptografa tokens de acesso e aplica limites por conta. Nada de scraping, bots de navegador ou pedido de senha do Instagram.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {["OAuth oficial da Meta", "Tokens protegidos", "Isolamento por workspace", "Logs de cada envio"].map((item) => (
              <li key={item} className="flex items-center gap-3 border-t border-[#d8cdbd] pt-4 text-sm font-bold">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#dff1e9] text-[11px] text-[#1d7a5d]">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <div className="mx-auto grid w-full max-w-7xl gap-8 overflow-hidden rounded-[28px] bg-[#f5c451] p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-end lg:p-14">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#675015]">A próxima conversa começa aqui</p>
            <h2 className="font-display mt-4 max-w-4xl text-4xl font-bold leading-[1.02] tracking-[-0.05em] sm:text-6xl">
              Transforme intenção em relacionamento — no tempo de um comentário.
            </h2>
          </div>
          <Link href="/login" className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#112620] px-6 py-4 text-sm font-black text-white transition hover:bg-[#1d3b32]">
            Começar agora
            <ArrowIcon />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#ded5c6] py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-[#66736e]">
            <Link href="/privacy" className="hover:text-[#112620]">Privacidade</Link>
            <Link href="/terms" className="hover:text-[#112620]">Termos</Link>
            <a href={PRODUCT.githubUrl} target="_blank" rel="noreferrer" className="hover:text-[#112620]">GitHub</a>
            <span>© {new Date().getFullYear()} ReplyFlow</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
