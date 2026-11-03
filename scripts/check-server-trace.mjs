import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Validate actual deployment manifests rather than the full development tree.
// A local next start can work even when Vercel's packaged functions lack WASM.
const routes = ['auth/nonce', 'auth/verify', 'agents', 'health', 'workflows', 'transactions'];
for (const route of routes) {
  const trace = resolve(`.next/server/app/api/${route}/route.js.nft.json`);
  const { files } = JSON.parse(await readFile(trace, 'utf8'));
  const compiler = files.find(file => file.replaceAll('\\', '/').endsWith('/.prisma/client/query_compiler_bg.wasm'));
  if (!compiler) throw new Error(`Prisma query compiler missing from deployment trace: /api/${route}`);
  await access(resolve(dirname(trace), compiler));
}
console.log(`Verified Prisma query compiler in ${routes.length} deployed API traces.`);
