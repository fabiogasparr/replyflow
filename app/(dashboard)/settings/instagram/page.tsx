import { Suspense } from "react";
import { InstagramOnboarding } from "@/components/instagram-onboarding";

export default function InstagramOnboardingPage() {
  return <Suspense fallback={<p role="status" className="p-6 text-muted">Preparando seu assistente…</p>}>
    <InstagramOnboarding />
  </Suspense>;
}
