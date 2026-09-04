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

  const [accounts, workspaces] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { username: true },
    }),
    listUserWorkspaces(context.userId),
  ]);

  return (
    <DashboardShell
      key={context.workspaceId}
      workspaceName={context.workspace.name}
      activeWorkspaceId={context.workspaceId}
      workspaces={workspaces}
      instagramUsername={accounts[0]?.username ?? null}
      instagramAccountCount={accounts.length}
    >
      {children}
    </DashboardShell>
  );
}
