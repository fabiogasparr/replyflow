import Link from "next/link";
import BrandMark from "@/components/brand-mark";
import { getAuthErrorContent } from "@/lib/auth-readiness";

export const metadata = {
  title: "Problema no acesso",
  description: "Orientações para recuperar o acesso ao ReplyFlow.",
};

export default async function LoginErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const content = getAuthErrorContent(error);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <section className="replyflow-rise w-full max-w-lg rounded-2xl border border-border bg-white p-7 shadow-[0_22px_70px_rgba(17,38,32,0.09)] sm:p-10">
        <BrandMark />
        <div className="mt-10 grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-2xl text-amber-800">
          <span aria-hidden="true">!</span>
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Área segura
        </p>
        <h1 className="font-display mt-3 text-3xl font-bold tracking-[-0.035em] text-foreground sm:text-4xl">
          {content.title}
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          {content.description}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-[#112620] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1c3a31]"
          >
            Voltar para o acesso
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-bold text-foreground transition hover:border-border-hover"
          >
            Ir para o início
          </Link>
        </div>
      </section>
    </main>
  );
}
