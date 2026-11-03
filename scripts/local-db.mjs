/** Development only. Uses the managed local Docker daemon; no remote context. */
import { spawnSync } from 'node:child_process';
const env = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
function docker(args, capture = false) {
  return spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'
  });
}
const name = 'agentra-postgres';
const existing = docker(['inspect', '--format', '{{.State.Running}}', name], true);
if (existing.status === 0) {
  if (existing.stdout.trim() !== 'true' && docker(['start', name]).status !== 0) process.exit(1);
} else {
  const healthy = docker(['info', '--format', '{{.ServerVersion}}'], true);
  if (healthy.status !== 0) {
    console.error('Local Docker is unavailable. Start Docker or configure DATABASE_URL for an existing PostgreSQL database.');
    process.exit(1);
  }
  const result = docker(['run', '-d', '--name', name,
    '-e', 'POSTGRES_USER=agentra', '-e', 'POSTGRES_PASSWORD=agentra_local_only',
    '-e', 'POSTGRES_DB=agentra', '-p', '127.0.0.1:5432:5432',
    '-v', 'agentra-pgdata:/var/lib/postgresql/data',
    'postgres:17.6-alpine']);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  if (docker(['exec', name, 'pg_isready', '-U', 'agentra', '-d', 'agentra'], true).status === 0) { ready = true; break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) { console.error('PostgreSQL did not become ready. Inspect docker logs agentra-postgres.'); process.exit(1); }
console.log('Local PostgreSQL ready on 127.0.0.1:5432. Development credentials only; configure a managed database for deployment.');
