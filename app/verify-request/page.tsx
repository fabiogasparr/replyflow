import Link from "next/link";
import BrandMark from "@/components/brand-mark";

export const metadata = {
  title: "Confira seu e-mail",
  description: "Enviamos um link de acesso para o seu e-mail.",
};

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandMark />
        </div>

        <div className="panel rounded p-8 text-center">
          <h2 className="mb-2 text-lg font-semibold">Confira seu e-mail</h2>
          <p className="text-sm text-muted">
            Enviamos um link seguro de acesso. Abra-o neste dispositivo para continuar.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/login" className="text-accent hover:underline">
              Voltar para o acesso
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
