import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { listUserWorkspaces } from "@/lib/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getCurrentWorkspaceContext();

  if (!context) {
    redirect("/login");
  }

  const [accounts, workspaces, platformUser] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { username: true },
    }),
    listUserWorkspaces(context.userId),
    prisma.user.findUnique({
      where: { id: context.userId },
      select: { platformRole: true },
    }),
  ]);

  return (
    <DashboardShell
      key={context.workspaceId}
      workspaceName={context.workspace.name}
      activeWorkspaceId={context.workspaceId}
      workspaces={workspaces}
      instagramUsername={accounts[0]?.username ?? null}
      instagramAccountCount={accounts.length}
      isPlatformAdmin={platformUser?.platformRole === "ADMIN"}
    >
      {children}
    </DashboardShell>
  );
}
