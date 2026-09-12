/**
 * The Coolify stack is the first permanent HTTPS origin the Meta app points at.
 * A silent drift here (a missing variable, a published database port, a secret
 * typed into the manifest) breaks OAuth or leaks data before anyone notices,
 * so the manifest is checked structurally without a YAML dependency.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = readFileSync(new URL("../compose.coolify.yml", import.meta.url), "utf8");
const servicesSection = manifest.split(/^services:\n/m)[1]?.split(/^volumes:\n/m)[0] ?? "";
const serviceBlocks = new Map(
  servicesSection
    .split(/^(?=  [a-z]+:\n)/m)
    .filter((block) => block.trim())
    .map((block) => [block.match(/^  ([a-z]+):/)?.[1] ?? "", block] as const)
);
const APP_SERVICES = ["web", "worker", "cron"] as const;
// Mirrors serverEnvSchema in lib/env.ts plus the runtime settings the Docker
// image reads (email provider, sign-in allowlist, Graph API version).
const REQUIRED_APP_ENV = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "CRON_SECRET",
  "ENCRYPTION_KEY",
  "WEBHOOK_VERIFY_TOKEN",
  "META_GRAPH_API_VERSION",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "FACEBOOK_APP_SECRET",
  "RESEND_API_KEY",
  "EMAIL_SERVER",
  "EMAIL_FROM",
  "ALLOWED_EMAILS",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_FALLBACK_MODEL",
];
const GENERATED_SECRETS: Record<string, RegExp> = {
  NEXTAUTH_SECRET: /^\$\{SERVICE_BASE64_64_[A-Z]+\}$/,
  CRON_SECRET: /^\$\{SERVICE_BASE64_64_[A-Z]+\}$/,
  WEBHOOK_VERIFY_TOKEN: /^\$\{SERVICE_BASE64_64_[A-Z]+\}$/,
  // lib/env.ts requires exactly 32 bytes as hex, i.e. a 64-character string.
  ENCRYPTION_KEY: /^\$\{SERVICE_HEX_64_[A-Z]+\}$/,
};
const OPERATOR_SECRETS = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "FACEBOOK_APP_SECRET", "RESEND_API_KEY", "EMAIL_SERVER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_FALLBACK_MODEL"];

function envOf(block: string): Map<string, string> {
  const env = block.split(/^    environment:\n/m)[1]?.split(/^    [a-z_]+:/m)[0] ?? "";
  return new Map(
    env
      .split("\n")
      .map((line) => line.match(/^      ([A-Z0-9_]+): ?(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2].trim()])
  );
}

describe("Coolify deployment manifest", () => {
  it("declares the full stack without publishing internal ports", () => {
    expect([...serviceBlocks.keys()]).toEqual(["postgres", "redis", "web", "worker", "cron"]);
    expect(manifest).not.toMatch(/^\s+ports:/m);
    expect(manifest).toMatch(/^volumes:\n  replyflow-postgres:\n  replyflow-redis:\n$/m);
  });

  it.each(APP_SERVICES)("gives %s every runtime variable and the shared image", (name) => {
    const block = serviceBlocks.get(name) ?? "";
    const env = envOf(block);
    expect([...env.keys()]).toEqual(expect.arrayContaining(REQUIRED_APP_ENV));
    expect(block).toContain("    image: replyflow-app:coolify\n");
    expect(block).toContain("      dockerfile: Dockerfile\n");
    expect(env.get("DATABASE_URL")).toBe(
      "postgresql://replyflow:${SERVICE_PASSWORD_64_POSTGRES}@postgres:5432/replyflow"
    );
    expect(env.get("REDIS_URL")).toBe("redis://redis:6379");
    expect(env.get("NEXTAUTH_URL")).toBe("${SERVICE_URL_WEB}");
    for (const [key, pattern] of Object.entries(GENERATED_SECRETS)) {
      expect(env.get(key), key).toMatch(pattern);
    }
    for (const key of OPERATOR_SECRETS) {
      expect(env.get(key), key).toBe(`\${${key}}`);
    }
  });

  it("exposes only the web service and runs migrations before serving", () => {
    const fqdnOccurrences = servicesSection.match(/SERVICE_FQDN_[A-Z]+_\d+/g) ?? [];
    expect(fqdnOccurrences).toEqual(["SERVICE_FQDN_WEB_3000"]);
    expect(envOf(serviceBlocks.get("web") ?? "").has("SERVICE_FQDN_WEB_3000")).toBe(true);
    expect(serviceBlocks.get("web")).toContain('command: ["sh", "-c", "npm run db:migrate && npm run start"]');
    expect(serviceBlocks.get("worker")).toContain('command: ["npm", "run", "worker"]');
    expect(serviceBlocks.get("cron")).toContain('command: ["sh", "scripts/cron.sh"]');
    expect(envOf(serviceBlocks.get("cron") ?? "").get("CRON_BASE_URL")).toBe("http://web:3000");
  });

  it("shares the generated database password with PostgreSQL", () => {
    expect(envOf(serviceBlocks.get("postgres") ?? "").get("POSTGRES_PASSWORD")).toBe("${SERVICE_PASSWORD_64_POSTGRES}");
    expect(manifest).not.toMatch(/(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z_]*: (?!\$\{)[^\s]/);
  });
});
