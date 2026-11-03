import { spawn } from 'node:child_process';
// Node 24 supports the inherited managed-cloud proxy without weakening TLS.
const env = { ...process.env };
if (env.HTTPS_PROXY || env.HTTP_PROXY) env.NODE_USE_ENV_PROXY = '1';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...process.argv.slice(2)], { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
