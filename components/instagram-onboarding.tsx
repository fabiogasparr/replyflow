"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { INSTAGRAM_CHECK_LABELS, type InstagramOnboardingData } from "@/lib/instagram-onboarding";

const STEPS = ["Preparar a conta", "Autorizar acesso", "Conferir conexão", "Primeira automação"];
const primary = "inline-flex items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
const secondary = "inline-flex items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export function InstagramOnboarding() {
  const params = useSearchParams();
  const expectedWorkspace = params.get("workspaceId");
  const callbackAccount = params.get("accountId");
  const [step, setStep] = useState(params.get("connected") === "true" ? 2 : params.has("instagram") ? 1 : 0);
  const [selectedId, setSelectedId] = useState(callbackAccount ?? "");
  const [data, setData] = useState<InstagramOnboardingData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const query = expectedWorkspace ? `?workspaceId=${encodeURIComponent(expectedWorkspace)}` : "";
        const response = await fetch(`/api/instagram/onboarding${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível consultar a conexão.");
        setData(result.data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setData(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível consultar a conexão.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [expectedWorkspace, refresh]);

  const account = selectedId ? data?.accounts.find((entry) => entry.id === selectedId) : data?.accounts[0];
  const atLimit = data?.accountLimit != null && data.accounts.length >= data.accountLimit;
  const canAuthorize = data?.canManage && data.oauthConfigured &&
    ((data.accountLimit != null && !atLimit) || data.accounts.length > 0);
  const connectUrl = `/api/instagram/connect?flow=wizard&workspaceId=${encodeURIComponent(data?.workspace.id ?? "")}`;
  function goTo(next: number) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <Link href="/settings" className="text-sm text-muted hover:text-foreground">← Configurações</Link>
    <header className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 sm:p-10">
      <div aria-hidden="true" className="absolute -right-8 -top-12 h-52 w-52 rounded-full border-[28px] border-accent/10" />
      <p className="relative text-xs font-semibold uppercase tracking-[0.22em] text-accent">Instagram · conexão guiada</p>
      <h1 className="relative mt-4 max-w-xl font-display text-3xl leading-tight sm:text-5xl">Seu próximo cliente começa com uma conversa.</h1>
      <p className="relative mt-4 max-w-xl text-sm leading-6 text-muted">Vamos preparar seu Instagram, autorizar o ReplyFlow e conferir o caminho até a primeira automação. Sem copiar tokens ou compartilhar senhas com nossa equipe.</p>
      {data && <p className="relative mt-5 text-xs text-muted">Espaço selecionado <span className="ml-2 font-semibold text-foreground">{data.workspace.name}</span></p>}
    </header>

    <InstagramConnectNotice />
    <nav aria-label="Etapas da conexão">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((label, index) => <li key={label}>
          <button type="button" aria-current={step === index ? "step" : undefined} onClick={() => goTo(index)} className={`flex h-full w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${step === index ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface"}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step === index ? "bg-accent text-white" : "bg-surface"}`}>{String(index + 1).padStart(2, "0")}</span>{label}
          </button>
        </li>)}
      </ol>
    </nav>

    {loading && <p role="status" className="text-sm text-muted">Consultando a configuração deste espaço…</p>}
    {error && <div role="alert" className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm">
      <p>{error}</p><button className={`${secondary} mt-3`} onClick={() => setRefresh((value) => value + 1)}>Tentar novamente</button>
    </div>}

    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <section className="panel min-w-0 rounded-2xl p-6 sm:p-8" aria-labelledby="wizard-heading">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Etapa {step + 1} de 4</p>
        <h2 id="wizard-heading" ref={heading} tabIndex={-1} className="mt-2 font-display text-2xl focus:outline-none">{STEPS[step]}</h2>

        {step === 0 && <div className="mt-6 space-y-5 text-sm leading-6">
          <p>Use uma conta profissional do Instagram, do tipo <strong>Empresa</strong> ou <strong>Criador de conteúdo</strong>. Uma conta pessoal precisa ser convertida antes de conectar.</p>
          <ol className="list-decimal space-y-3 pl-5 text-muted">
            <li>Abra as configurações do perfil no aplicativo Instagram e procure as opções de tipo de conta e ferramentas profissionais. Os nomes podem variar conforme a versão.</li>
            <li>Se o perfil ainda for pessoal, siga as orientações do Instagram para mudar para uma conta profissional.</li>
            <li>Tenha acesso ao perfil que deseja conectar e confira o espaço de trabalho acima. A conexão ficará vinculada a este cliente.</li>
          </ol>
          <p className="rounded-lg border border-border bg-surface p-4">Conta profissional não é o mesmo que selo azul ou Meta Verified. Este assistente não solicita a compra de um selo e não promete aprovação pela Meta.</p>
          <a href="https://help.instagram.com/502981923235522" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">Consultar a orientação oficial do Instagram ↗</a>
          <div className="pt-2"><button className={primary} onClick={() => goTo(1)}>Continuar para autorização →</button></div>
        </div>}

        {step === 1 && <div className="mt-6 space-y-5 text-sm leading-6">
          <p>A próxima tela é do próprio Instagram. Confira o perfil escolhido e revise o acesso solicitado antes de confirmar.</p>
          <ul className="space-y-2 text-muted">
            <li>• Identificação do perfil profissional para vincular a conta.</li>
            <li>• Comentários e mensagens para executar suas automações.</li>
            <li>• Métricas para acompanhar resultados nos relatórios.</li>
          </ul>
          {data && !data.canManage && <p role="status" className="text-warning">Peça a um proprietário ou administrador deste espaço para realizar a autorização.</p>}
          {data && !data.oauthConfigured && <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-4">A equipe ReplyFlow ainda precisa configurar a integração. Você já pode consultar o guia, mas a autorização está indisponível por enquanto.</p>}
          {data?.accountLimit === null && <p className="text-warning">O plano deste espaço precisa ser configurado antes de adicionar uma conta. Contas existentes podem ser reconectadas.</p>}
          {atLimit && <p className="text-warning">Limite de {data?.accountLimit} conta(s) atingido. Você pode renovar a autorização de uma conta já conectada; para adicionar outra, ajuste o plano nas Configurações.</p>}
          {canAuthorize && !loading ? <a className={primary} href={connectUrl}>{atLimit || data?.accountLimit === null ? "Reconectar pelo Instagram ↗" : "Autorizar no Instagram ↗"}</a> : <button className={`${primary} cursor-not-allowed opacity-50`} disabled>Autorização indisponível</button>}
          <p className="text-xs text-muted">Não pedimos sua senha do Instagram no ReplyFlow. Você pode desconectar a conta nas Configurações e revogar o acesso nas opções do Instagram.</p>
          <button className={secondary} onClick={() => goTo(2)}>Já autorizei · conferir conexão</button>
        </div>}

        {step === 2 && <div className="mt-6 space-y-5 text-sm leading-6">
          <p>Estes dados vêm da configuração salva no ReplyFlow. Não são uma consulta ao vivo à Meta nem comprovam que mensagens já estão sendo entregues.</p>
          {data && !loading && <>
            {data.accounts.length > 0 && <div>
              <label htmlFor="instagram-account" className="mb-2 block text-xs font-semibold text-muted">Conta deste espaço</label>
              <select id="instagram-account" value={account?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className="w-full rounded-lg border border-border bg-surface p-3 text-foreground">
                {!account && <option value="">Selecione uma conta</option>}
                {data.accounts.map((entry) => <option key={entry.id} value={entry.id}>@{entry.username}</option>)}
              </select>
            </div>}
            {!account ? <p className="rounded-lg border border-warning/30 bg-warning/10 p-4">{selectedId ? "A conta retornada não está disponível neste espaço. Confira o cliente selecionado e escolha uma conta ou autorize novamente." : "Nenhuma conta conectada neste espaço. Volte à autorização para começar."}</p> : <div className="divide-y divide-border rounded-lg border border-border px-4">
              <CheckRow title="Autorização registrada" detail={`@${account.username} está vinculado a este espaço.`} />
              <CheckRow title={INSTAGRAM_CHECK_LABELS[account.check]} detail={account.tokenExpiresAt ? `Expiração prevista: ${new Date(account.tokenExpiresAt).toLocaleString("pt-BR")}. O acesso pode ser revogado antes desta data.` : "Não há data de expiração registrada. Autorize novamente para atualizar a conexão."} />
              <CheckRow title={account.webhookSubscribed ? "Inscrição em notificações registrada" : "Inscrição em notificações pendente"} detail={account.webhookSubscribed ? "A inscrição foi salva na conexão. Ainda é necessário receber um evento real para validar o funcionamento." : "Autorize novamente para tentar inscrever a conta. Se persistir, o administrador do ReplyFlow deve revisar os webhooks na Meta."} />
            </div>}
            {account && account.check !== "ready_to_test" && <button className={secondary} onClick={() => goTo(1)}>Revisar autorização</button>}
          </>}
          <div className="flex flex-wrap gap-3">
            <button disabled={loading} className={`${secondary} disabled:opacity-50`} onClick={() => setRefresh((value) => value + 1)}>{loading ? "Consultando…" : "Atualizar configuração"}</button>
            <button className={primary} onClick={() => goTo(3)}>Ver como testar →</button>
          </div>
        </div>}

        {step === 3 && <div className="mt-6 space-y-5 text-sm leading-6">
          <p>Agora vamos validar o caminho completo: comentário → automação → resposta privada. Esta etapa exige uma ação real no Instagram.</p>
          <ol className="list-decimal space-y-3 pl-5 text-muted">
            <li>Crie uma automação para a conta conectada, escolha uma publicação e uma palavra-chave específica, como QUEROTESTAR.</li>
            <li>Revise a mensagem e ative a automação somente quando estiver pronto para responder a comentários reais.</li>
            <li>Use outra conta autorizada para o teste para comentar a palavra-chave. Confira a resposta privada recebida no Instagram e o histórico de envios no ReplyFlow.</li>
          </ol>
          <p className="rounded-lg border border-border bg-surface p-4">Se não houver resposta, confira a autorização, a inscrição em notificações e o histórico de erros. Em modo de desenvolvimento, a Meta restringe quem pode testar. A liberação para clientes externos depende do aplicativo da plataforma.</p>
          <div className="flex flex-wrap gap-3">
            {data?.canManage && account?.check === "ready_to_test" && !loading && <Link className={primary} href="/campaigns/new">Criar primeira automação →</Link>}
            <Link className={secondary} href="/logs">Abrir histórico de envios</Link>
            <button className={secondary} onClick={() => goTo(2)}>Rever conexão</button>
          </div>
          <p className="text-xs text-muted">Este guia não ativa automações nem envia mensagens por conta própria. Um envio de teste bem-sucedido não significa aprovação do aplicativo pela Meta.</p>
        </div>}
      </section>
      <aside className="space-y-5 self-start rounded-2xl border border-border p-6 text-sm leading-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Quem faz o quê</p>
        <div><h3 className="font-semibold">Você, cliente</h3><p className="mt-1 text-muted">Prepara o perfil profissional, autoriza o acesso e testa a automação da sua conta.</p></div>
        <div><h3 className="font-semibold">Equipe ReplyFlow</h3><p className="mt-1 text-muted">Configura o aplicativo, os endereços e as notificações. Solicita a análise e os acessos exigidos pela Meta para atender clientes externos.</p></div>
        <div className="border-t border-border pt-4"><h3 className="font-semibold">A Meta decide a aprovação</h3><p className="mt-1 text-muted">O assistente orienta e mostra pendências. Não aprova contas e não substitui a análise da Meta.</p></div>
      </aside>
    </div>
  </div>;
}

function CheckRow({ title, detail }: { title: string; detail: string }) {
  return <div className="py-4"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted">{detail}</p></div>;
}
