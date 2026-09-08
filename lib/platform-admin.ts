import type { PlatformRole } from "@/app/generated/prisma/client";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export type PlatformAccess = {
  authenticated: boolean;
  role: PlatformRole | null;
  admin:
    | {
        id: string;
        name: string | null;
        email: string | null;
      }
    | null;
};

export async function getPlatformAccess(): Promise<PlatformAccess> {
  const userId = await getCurrentUserId();
  if (!userId) return { authenticated: false, role: null, admin: null };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
    },
  });
  if (!user) return { authenticated: true, role: null, admin: null };

  return {
    authenticated: true,
    role: user.platformRole,
    admin:
      user.platformRole === "ADMIN"
        ? { id: user.id, name: user.name, email: user.email }
        : null,
  };
}
