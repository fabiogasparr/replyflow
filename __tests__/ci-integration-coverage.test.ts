/** A green unit suite must not silently omit an existing database/Redis smoke from CI. */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  scripts: Record<string, string>;
};
const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const integrationEntries = Object.entries(manifest.scripts)
  .filter(([name]) => /^test:.*-(?:db|redis|queue)$/.test(name));
const integrationFiles = readdirSync(new URL("scripts/", root))
  .filter((name) => /^test-.*-(?:db|redis|queue)\.ts$/.test(name));
// Intentional contract: integrations each have a named step and a literal run command.
// Changing to a reusable workflow or matrix requires updating this gate explicitly.
const steps = workflow.split(/(?=^      - name:)/m);

describe("integration coverage in GitHub CI", () => {
  it("finds the integration inventory and bounds the job duration", () => {
    expect(integrationEntries.length).toBeGreaterThan(0);
    expect(integrationFiles.length).toBe(integrationEntries.length);
    expect(workflow).toMatch(/^    timeout-minutes: 20$/m);
  });

  it.each(integrationFiles)("registers the real integration script %s", (file) => {
    expect(integrationEntries.filter(([, command]) => command === `tsx scripts/${file}`)).toHaveLength(1);
  });

  it.each(integrationEntries)("executes %s once with an explicit local test service", (name) => {
    const step = steps.filter((block) => block.split("\n").includes(`        run: npm run ${name}`));
    expect(step).toHaveLength(1);
    if (name.endsWith("-db")) {
      expect(step[0]).toContain("          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/replyflow_test");
    } else {
      expect(step[0]).toContain("          TEST_REDIS_URL: redis://localhost:6379");
    }
    expect(step[0]).not.toMatch(/continue-on-error:\s*true|\|\|\s*true/);
  });
});
