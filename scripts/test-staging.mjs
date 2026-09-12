/** Runs only against the isolated staging installation and its local mail sink. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const env = parse(readFileSync(new URL('../.env.staging', import.meta.url)));
const base = new URL(env.NEXTAUTH_URL);
assert.equal(new URL(env.DATABASE_URL).pathname, '/replyflow_staging');
assert.equal(env.EMAIL_SERVER, 'smtp://mailpit:1025');
assert.ok(base.origin === 'http://localhost:3100' || (base.protocol === 'https:' && base.hostname.endsWith('.trycloudflare.com')));
const mailpit = 'http://localhost:8026';
const health = await fetch(`${base.origin}/api/health`, { signal: AbortSignal.timeout(20000) });
assert.equal(health.status, 200, 'Banco, Redis, fila e worker devem estar disponíveis.');
const unauthenticated = await fetch(`${base.origin}/api/contact-fields`);
assert.equal(unauthenticated.status, 401, 'Dados do CRM não podem ser públicos.');
assert.equal((await fetch(`${base.origin}/api/instagram/onboarding`)).status, 401, 'Assistente exige autenticação.');

function client() {
  const cookies = new Map();
  return async function request(path, init = {}) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, 'Não enviar sessão para outra origem.');
    const response = await fetch(url, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { ...init.headers, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const equal = pair.indexOf('=');
      cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return response;
  };
}

async function login(email) {
  const request = client();
  const csrf = await (await request('/api/auth/csrf')).json();
  assert.ok(csrf.csrfToken, 'CSRF de autenticação disponível.');
  const signIn = await request('/api/auth/signin/nodemailer', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, callbackUrl: `${base.origin}/dashboard` }),
  });
  assert.ok([200, 302, 303].includes(signIn.status), 'Solicitação de acesso aceita.');
  const listing = await (await fetch(`${mailpit}/api/v1/messages`)).json();
  const message = listing.messages.find(message => message.To.some(to => to.Address === email));
  assert.ok(message, 'Link de acesso capturado no Mailpit local.');
  const content = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
  const link = content.Text.match(/https?:\/\/[^\s]+\/api\/auth\/callback\/nodemailer\?[^\s]+/);
  assert.ok(link, 'E-mail contém callback de autenticação.');
  const signedIn = await request(link[0]);
  assert.ok([302, 303].includes(signedIn.status), 'Callback de acesso concluído.');
  const session = await (await request('/api/auth/session')).json();
  assert.equal(session.user?.email, email, 'Sessão corresponde ao destinatário de teste.');
  const stats = await (await request('/api/dashboard/stats')).json();
  assert.equal(stats.success, true, 'Painel integrado ao banco.');
  assert.equal(stats.data.workspace.billingReady, true, 'Workspace novo recebe assinatura e limites.');
  return request;
}

// Malformed recipient syntax must never reach SMTP, even when its first
// address is allowlisted. This exercises Auth.js normalization, not just helpers.
for (const email of ['tester@replyflow.test,blocked@replyflow.test', 'Tester <tester@replyflow.test>', 'tester@replyflow.test(comment)']) {
  const request = client();
  const csrf = await (await request('/api/auth/csrf')).json();
  const before = await (await fetch(`${mailpit}/api/v1/messages`)).json();
  const response = await request('/api/auth/signin/nodemailer', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, callbackUrl: `${base.origin}/dashboard` }),
  });
  const target = new URL(response.headers.get('location'), base);
  assert.ok(target.searchParams.has('error'), 'Sintaxe ambígua deve ser rejeitada no fluxo real de login.');
  const after = await (await fetch(`${mailpit}/api/v1/messages`)).json();
  assert.equal(after.total, before.total, 'Tentativa inválida não pode gerar e-mail. Execute sem logins concorrentes.');
}

const first = await login('tester@replyflow.test');
const second = await login('tenant2@replyflow.test');
const firstOnboardingResponse = await first('/api/instagram/onboarding');
assert.equal(firstOnboardingResponse.status, 200);
assert.equal(firstOnboardingResponse.headers.get('cache-control'), 'private, no-store');
const firstOnboarding = (await firstOnboardingResponse.json()).data;
const secondOnboarding = (await (await second('/api/instagram/onboarding')).json()).data;
assert.notEqual(firstOnboarding.workspace.id, secondOnboarding.workspace.id, 'Cada cliente tem seu próprio espaço.');
assert.equal(firstOnboarding.canManage, true, 'Proprietário pode iniciar autorização.');
assert.equal((await second(`/api/instagram/onboarding?workspaceId=${encodeURIComponent(firstOnboarding.workspace.id)}`)).status, 409, 'Retorno do wizard não pode selecionar outro tenant.');
const wizardPage = await first('/settings/instagram');
assert.equal(wizardPage.status, 200, 'Página protegida do assistente disponível.');
assert.ok((await wizardPage.text()).includes('conexão guiada'), 'Página inclui o assistente.');
const created = await (await first('/api/contact-fields', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `Teste de isolamento ${Date.now()}`, type: 'TEXT' }),
})).json();
assert.equal(created.success, true, 'Primeiro tenant pode criar dados no CRM.');
const list = await (await second('/api/contact-fields')).json();
assert.ok(!list.data.fields.some(field => field.id === created.data.field.id), 'Segundo tenant não pode ler o campo do primeiro.');
const foreignWrite = await second(`/api/contact-fields/${created.data.field.id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Não deve alterar' }),
});
assert.equal(foreignWrite.status, 404, 'Segundo tenant não pode alterar campo alheio.');
const connection = await first('/api/instagram/connect');
if (!env.INSTAGRAM_APP_ID) {
  assert.ok(connection.headers.get('location')?.includes('instagram=misconfigured'), 'Conexão sem credenciais deve explicar a pendência.');
  const wizardConnect = await first(`/api/instagram/connect?flow=wizard&workspaceId=${encodeURIComponent(firstOnboarding.workspace.id)}`);
  assert.equal(new URL(wizardConnect.headers.get('location')).pathname, '/settings/instagram', 'Falha de configuração retorna ao wizard.');
}
console.log('✓ HTTPS/HTTP, saúde, rejeição de destinatários ambíguos, login por e-mail, dois tenants, assinatura Free, wizard e isolamento real aprovados.');
console.log('Nenhuma mensagem foi enviada ao Instagram. E-mails capturados somente no Mailpit.');
