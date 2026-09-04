import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import BrandMark from "@/components/brand-mark";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export const metadata: Metadata = {
  title: "Aceitar convite",
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
        <div className="mb-8">
          <BrandMark />
        </div>
        <section className="rounded-2xl border border-border bg-white p-8 shadow-[0_22px_70px_rgba(17,38,32,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            Convite para equipe
          </p>
          <h1 className="font-display mt-4 text-3xl font-bold leading-tight text-foreground">
            Entre em {invitation.workspace.name}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            O convite foi enviado para {invitation.email} com o perfil{" "}
            {invitation.role.toLowerCase()}.
          </p>
          <div className="mt-8">
            {expired ? (
              <p className="text-sm text-error">
                Este convite expirou. Peça ao responsável pelo espaço para enviá-lo novamente.
              </p>
            ) : (
              <InvitationAcceptCard
                token={token}
                isSignedIn={Boolean(session?.user?.id)}
                invitedEmail={invitation.email}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
