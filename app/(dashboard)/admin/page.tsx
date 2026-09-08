import { notFound } from "next/navigation";
import PlatformOverview from "@/components/platform-overview";
import { getPlatformAccess } from "@/lib/platform-admin";

export default async function PlatformAdminPage() {
  const access = await getPlatformAccess();
  if (!access.admin) notFound();

  return <PlatformOverview adminName={access.admin.name ?? access.admin.email} />;
}

