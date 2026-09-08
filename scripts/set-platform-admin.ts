import { getPrisma } from "../lib/db/client";

const [action, rawEmail, confirmation] = process.argv.slice(2);
const normalizedEmail = rawEmail?.trim().toLowerCase();

function usage(): never {
  throw new Error(
    "Uso: npm run admin:role -- <grant|revoke> <email> --confirm"
  );
}

async function main() {
  if (
    !["grant", "revoke"].includes(action ?? "") ||
    !normalizedEmail ||
    confirmation !== "--confirm"
  ) {
    usage();
  }

  const prisma = getPrisma();
  const result = await prisma.$transaction(
    async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, emailVerified: true, platformRole: true },
      });
      if (!user) throw new Error("Usuário não encontrado");
      if (!user.emailVerified) {
        throw new Error("O usuário precisa ter um e-mail verificado");
      }

      if (action === "revoke" && user.platformRole === "ADMIN") {
        const adminCount = await transaction.user.count({
          where: { platformRole: "ADMIN" },
        });
        if (adminCount <= 1) {
          throw new Error("Não é permitido remover o último administrador global");
        }
      }

      const platformRole = action === "grant" ? "ADMIN" : "USER";
      await transaction.user.update({
        where: { id: user.id },
        data: { platformRole },
      });
      return { email: user.email, platformRole };
    },
    { isolationLevel: "Serializable" }
  );
  console.log(
    `${result.email ?? normalizedEmail}: papel global atualizado para ${result.platformRole}.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha inesperada");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
