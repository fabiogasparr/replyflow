import Link from "next/link";
import { redirect } from "next/navigation";
import BrandMark from "@/components/brand-mark";
import { DemoNotice } from "@/components/demo-notice";
import { EMAIL_PROVIDER_ID, signIn } from "@/lib/auth";
import { getEmailAuthReadiness } from "@/lib/auth-readiness";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

export const metadata = {
  title: "Entrar",
  description: "Acesse o ReplyFlow para gerenciar suas automações no Instagram.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
  }>;
}) {
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";
  const emailReadiness = getEmailAuthReadiness();

  async function sendMagicLink(formData: FormData) {
    "use server";
    if (!getEmailAuthReadiness().ready) {
      redirect("/login/error?error=Configuration");
    }
    await signIn(EMAIL_PROVIDER_ID, {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[0.88fr_1.12fr]">
      <section className="relative hidden overflow-hidden bg-[#112620] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="brand-grid absolute inset-0 opacity-[0.055]" aria-hidden="true" />
        <div className="relative">
          <BrandMark tone="light" />
        </div>

        <div className="relative max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#f5c451]">
            Automação que conversa
          </p>
          <h1 className="font-display mt-5 text-5xl font-bold leading-[1.04] tracking-[-0.045em] xl:text-6xl">
            Seu próximo cliente pode estar em um comentário.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#b8c7c1]">
            Conecte o Instagram, escolha as palavras-chave e deixe o ReplyFlow
            transformar interesse em conversa — com rastreabilidade de ponta a ponta.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3 text-xs text-[#b8c7c1]">
          {["API oficial da Meta", "Tokens criptografados", "Envios monitorados"].map(
            (item) => (
              <div key={item} className="border-t border-white/15 pt-3">
                {item}
              </div>
            )
          )}
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="replyflow-rise w-full max-w-md">
          <div className="mb-10 flex items-center justify-between lg:hidden">
            <BrandMark />
            <Link href="/" className="text-sm font-semibold text-muted hover:text-foreground">
              Voltar
            </Link>
          </div>

          <div className="mb-7">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
              Área segura
            </p>
            <h2 className="font-display mt-3 text-4xl font-bold tracking-[-0.04em] text-foreground">
              {checkEmail ? "Confira seu e-mail" : "Bem-vindo de volta"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              {checkEmail
                ? "Enviamos um link seguro para você entrar sem precisar memorizar outra senha."
                : selectedTemplate
                  ? `Entre para usar o modelo “${selectedTemplate.title}”.`
                  : "Use seu e-mail profissional para acessar o seu espaço de trabalho."}
            </p>
          </div>

          <DemoNotice variant="panel" />

          <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_22px_70px_rgba(17,38,32,0.09)] sm:p-8">
            {selectedTemplate && !checkEmail && (
              <div className="mb-5 rounded-xl border border-[#ff6b4a]/25 bg-[#fff1ec] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                  Modelo selecionado
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {selectedTemplate.title}
                </p>
              </div>
            )}

            {!checkEmail && !emailReadiness.ready && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
              >
                {emailReadiness.message}
              </div>
            )}

            {checkEmail ? (
              <div className="py-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-[#e3f2eb] text-success">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current stroke-2">
                    <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="mt-5 text-sm leading-6 text-muted">
                  Abra o link neste dispositivo. Se ele não aparecer em alguns minutos,
                  verifique também a caixa de spam.
                </p>
                <Link
                  href="/login"
                  className="mt-5 inline-flex text-sm font-bold text-foreground underline decoration-accent decoration-2 underline-offset-4"
                >
                  Usar outro e-mail
                </Link>
              </div>
            ) : (
              <form action={sendMagicLink} className="space-y-5">
                <fieldset
                  disabled={!emailReadiness.ready}
                  className="space-y-5 disabled:opacity-60"
                >
                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-sm font-semibold text-foreground">
                      E-mail profissional
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="voce@empresa.com.br"
                      className="w-full rounded-xl border border-border bg-background px-4 py-3.5 text-sm text-foreground placeholder:text-[#9aa49f] transition-colors focus:border-accent focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#112620] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#1c3a31] disabled:cursor-not-allowed"
                  >
                    {emailReadiness.ready
                      ? "Receber link de acesso"
                      : "Envio indisponível"}
                    <span aria-hidden="true">→</span>
                  </button>
                </fieldset>
              </form>
            )}
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-muted">
            Ao continuar, você concorda com os nossos{" "}
            <Link href="/terms" className="font-semibold text-foreground underline underline-offset-2">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacy" className="font-semibold text-foreground underline underline-offset-2">
              Política de Privacidade
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
