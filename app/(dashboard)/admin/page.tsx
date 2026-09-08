import { notFound } from "next/navigation";
import PlatformOverview from "@/components/platform-overview";
import PlatformOperations from "@/components/platform-operations";
import { getPlatformAccess } from "@/lib/platform-admin";

export default async function PlatformAdminPage() {
  const access = await getPlatformAccess();
  if (!access.admin) notFound();

  const adminName = access.admin.name ?? access.admin.email;
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a7310]">
          Operação ReplyFlow
        </p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">
          Administração da plataforma
        </h1>
        <p className="mt-1 text-sm text-muted">
          Visão global somente leitura{adminName ? ` para ${adminName}` : ""}.
          Nenhuma ação altera clientes ou planos.
        </p>
      </div>
      <PlatformOperations />
      <PlatformOverview adminName={adminName} showHeader={false} />
    </div>
  );
}
