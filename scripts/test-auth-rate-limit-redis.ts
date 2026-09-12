/** Atomicity and expiry checks. Only unique synthetic keys are created or removed. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { getAuthEmailLimitKeys, reserveAuthEmail, reserveAuthEmailSlot } from "../lib/auth-rate-limit";

async function main() {
const value = process.env.TEST_REDIS_URL;
if (!value) throw new Error("Defina TEST_REDIS_URL para o Redis de teste.");
const address = new URL(value);
if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
  throw new Error("O teste aceita somente Redis em loopback.");
}
const redis = new Redis(value, { maxRetriesPerRequest: 0, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null });
redis.on("error", () => {});
const createdKeys = new Set<string>();
const secret = randomBytes(32).toString("hex");
function keys(email: string, namespace = secret) {
  const result = getAuthEmailLimitKeys(email, namespace);
  result.forEach((key) => createdKeys.add(key));
  return result;
}

try {
  const email = "recipient@replyflow.test";
  const recipientKeys = keys(email);
  const attempts = await Promise.all(Array.from({ length: 50 }, () => reserveAuthEmailSlot(redis, email, secret)));
  assert.equal(attempts.filter((result) => result.allowed).length, 1, "Concorrência deve reservar um único envio por intervalo.");
  for (const [index, maximum] of [3600, 900, 60].entries()) {
    const ttl = await redis.ttl(recipientKeys[index]);
    assert.ok(ttl > 0 && ttl <= maximum, "Todas as chaves devem expirar.");
  }
  const initialTtl = await redis.ttl(recipientKeys[2]);
  await reserveAuthEmailSlot(redis, email, secret);
  assert.ok(await redis.ttl(recipientKeys[2]) <= initialTtl, "Pedidos negados não estendem o bloqueio.");
  assert.equal(await redis.get(recipientKeys[0]), "1", "Rejeições não consomem limite global.");

  await redis.pexpire(recipientKeys[2], 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await reserveAuthEmailSlot(redis, email, secret), { allowed: true }, "Envio volta a funcionar depois da expiração.");
  for (let index = 0; index < 3; index++) {
    await redis.del(recipientKeys[2]); // Simulate cooldown passage for this test's keys only.
    assert.deepEqual(await reserveAuthEmailSlot(redis, email, secret), { allowed: true });
  }
  await redis.del(recipientKeys[2]);
  assert.equal((await reserveAuthEmailSlot(redis, email, secret)).allowed, false, "Sexto envio na janela deve ser rejeitado.");

  const globalSecret = randomBytes(32).toString("hex");
  const recipients = Array.from({ length: 20 }, (_, index) => `recipient${index}@replyflow.test`);
  recipients.forEach((entry) => keys(entry, globalSecret));
  const globalAttempts = await Promise.all(recipients.map((entry) => reserveAuthEmailSlot(redis, entry, globalSecret, 3)));
  assert.equal(globalAttempts.filter((result) => result.allowed).length, 3, "Limite global deve ser atômico entre destinatários.");

  const unrelatedSecret = randomBytes(32).toString("hex");
  keys(email, unrelatedSecret);
  assert.deepEqual(await reserveAuthEmailSlot(redis, email, unrelatedSecret), { allowed: true }, "Instalações com segredos diferentes não compartilham quotas.");
  // Exercise the actual bounded connection used by sign-in, not just its Lua helper.
  const wrapperSecret = randomBytes(32).toString("hex");
  keys(email, wrapperSecret);
  process.env.REDIS_URL = value;
  process.env.NEXTAUTH_SECRET = wrapperSecret;
  delete process.env.AUTH_EMAIL_GLOBAL_LIMIT;
  assert.deepEqual(await reserveAuthEmail(email), { allowed: true }, "Conexão usada no login deve reservar o primeiro envio.");
  const duplicate = await reserveAuthEmail(email);
  assert.ok(!duplicate.allowed && duplicate.reason === "limited", "Nova conexão deve compartilhar a quota já reservada.");
  console.log("✓ Redis real: concorrência, expiração, quotas por endereço/global, isolamento e conexão do login aprovados.");
} finally {
  try {
    if (createdKeys.size) await redis.del(...createdKeys);
  } finally {
    redis.disconnect();
  }
}
}

main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "Falha no teste: confira TEST_REDIS_URL e a disponibilidade do Redis descartável.");
  process.exitCode = 1;
});
