import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const envPath = fileURLToPath(new URL('../.env.staging', import.meta.url));
const [command, address] = process.argv.slice(2);
const secret = () => randomBytes(32).toString('hex');

if (command === 'init') {
  const password = secret();
  const values = {
    STAGING_DB_PASSWORD: password,
    DATABASE_URL: `postgresql://replyflow:${password}@postgres:5432/replyflow_staging`,
    REDIS_URL: 'redis://redis:6379',
    NEXTAUTH_URL: 'http://localhost:3100',
    NEXTAUTH_SECRET: secret(),
    ENCRYPTION_KEY: secret(),
    CRON_SECRET: secret(),
    WEBHOOK_VERIFY_TOKEN: secret(),
    INSTAGRAM_APP_ID: '',
    INSTAGRAM_APP_SECRET: '',
    FACEBOOK_APP_SECRET: '',
    META_GRAPH_API_VERSION: 'v25.0',
    EMAIL_SERVER: 'smtp://mailpit:1025',
    EMAIL_FROM: 'ReplyFlow Teste <login@replyflow.test>',
    ALLOWED_EMAILS: 'tester@replyflow.test,tenant2@replyflow.test',
  };
  try {
    writeFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Ambiente isolado preparado em .env.staging. Segredos não exibidos.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('.env.staging já existe; configuração e chaves preservadas.');
  }
} else if (command === 'url') {
  const url = new URL(address);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new Error('Use somente a origem HTTPS temporária retornada pelo túnel Cloudflare.');
  }
  const contents = readFileSync(envPath, 'utf8');
  if (!/^NEXTAUTH_URL=.*$/m.test(contents)) throw new Error('NEXTAUTH_URL ausente; execute init.');
  writeFileSync(envPath, contents.replace(/^NEXTAUTH_URL=.*$/m, `NEXTAUTH_URL=${JSON.stringify(url.origin)}`), { mode: 0o600 });
  console.log(`Endereço configurado: ${url.origin}`);
  console.log('Recrie web, worker e cron para aplicar. Não recrie o túnel.');
} else if (command === 'preflight') {
  const disk = statfsSync(new URL('../', import.meta.url));
  const freeGiB = disk.bavail * disk.bsize / 1024 ** 3;
  console.log(`Espaço disponível: ${freeGiB.toFixed(1)} GiB.`);
  if (freeGiB < 6) {
    console.error('Construção bloqueada: libere pelo menos 6 GiB antes de iniciar o Docker de homologação.');
    process.exitCode = 1;
  } else {
    console.log('Espaço mínimo para a construção verificado.');
  }
} else if (command === 'check') {
  const env = parse(readFileSync(envPath));
  const required = ['DATABASE_URL', 'REDIS_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'ENCRYPTION_KEY', 'CRON_SECRET'];
  const missing = required.filter(key => !env[key]);
  console.log(`Infraestrutura configurada: ${missing.length ? 'não; faltam ' + missing.join(', ') : 'sim (verificação de formato)'}`);
  const meta = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN'];
  const pending = meta.filter(key => !env[key] || /placeholder|your-|replace|example/i.test(env[key]));
  console.log(`Credenciais Meta: ${pending.length ? 'pendentes: ' + pending.join(', ') : 'preenchidas; validar autorização na Meta'}`);
  console.log(`Endereço: ${env.NEXTAUTH_URL}`);
  console.log(`Callback OAuth: ${env.NEXTAUTH_URL}/api/instagram/callback`);
  console.log(`Webhook: ${env.NEXTAUTH_URL}/api/webhook`);
  console.log('App Review e acesso avançado: confirmar no painel Meta; não inferidos de variáveis.');
  console.log('E-mails de teste: Mailpit somente em http://localhost:8026.');
  if (missing.length) process.exitCode = 1;
} else {
  console.error('Uso: node scripts/staging.mjs init | preflight | url https://ENDERECO.trycloudflare.com | check');
  process.exitCode = 1;
}
