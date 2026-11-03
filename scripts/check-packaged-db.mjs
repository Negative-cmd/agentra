import {readFile,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
if (!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Use a local development database for this regression check');
const root=process.cwd();const trace=resolve('.next/server/app/api/auth/nonce/route.js.nft.json');
const artifact=await mkdtemp(join(tmpdir(),'agentra-function-'));
try {
 const {files}=JSON.parse(await readFile(trace,'utf8'));
 for(const file of files){const absolute=resolve(dirname(trace),file);const path=relative(root,absolute);if(!path.startsWith('node_modules/'))continue;const target=join(artifact,path);await mkdir(dirname(target),{recursive:true});await copyFile(absolute,target);}
 const code=`const {PrismaClient}=require('@prisma/client');const {PrismaPg}=require(${JSON.stringify(join(root,'node_modules/@prisma/adapter-pg'))});const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});db.user.count().then(()=>console.log('Packaged Prisma query passed')).catch(e=>{console.error(JSON.stringify({error:e.name,missingCompiler:/ENOENT|query_compiler_bg.wasm/.test(e.message)}));process.exitCode=1;}).finally(()=>db.$disconnect());`;
 const result=spawnSync(process.execPath,['-e',code],{cwd:artifact,env:process.env,encoding:'utf8'});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;
} finally{await rm(artifact,{recursive:true,force:true});}
