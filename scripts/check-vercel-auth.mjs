/** Local HTTP regression for Vercel trusted origins with an incorrect APP_URL.
 * Start a production server on :3200 with VERCEL=1 VERCEL_ENV=production,
 * VERCEL_PROJECT_PRODUCTION_URL=agentra-psi.vercel.app and an incorrect APP_URL.
 * This test uses an ephemeral unfunded signer, and deletes only its test records. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {createSiweMessage} from 'viem/siwe';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const base='http://localhost:3200';
assert(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const account=privateKeyToAccount(generatePrivateKey());let nonce;
const origin='https://agentra-psi.vercel.app';
const cookies = response => response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
try {
 const response=await fetch(base+'/api/auth/nonce',{headers:{Origin:origin}});
 assert.equal(response.status,200);const challenge=await response.json();nonce=challenge.nonce;
 assert.equal(challenge.uri,origin);assert.equal(challenge.domain,'agentra-psi.vercel.app');
 const message=createSiweMessage({domain:challenge.domain,address:account.address,statement:'Local origin regression test.',uri:challenge.uri,version:'1',chainId:challenge.chainId,nonce,issuedAt:new Date()});
 const signature=await account.signMessage({message});
 const headers={'Content-Type':'application/json',Origin:origin,Cookie:cookies(response)};
 const body=JSON.stringify({message,signature});
 const evil=await fetch(base+'/api/auth/verify',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body});assert.equal(evil.status,403);
 const verified=await fetch(base+'/api/auth/verify',{method:'POST',headers,body});assert.equal(verified.status,200,await verified.text());
 const session=await fetch(base+'/api/session',{headers:{Cookie:cookies(verified)}});assert.equal((await session.json()).user.address,account.address.toLowerCase());
 const replay=await fetch(base+'/api/auth/verify',{method:'POST',headers,body});assert.equal(replay.status,401);
 console.log('PASS: trusted production origin signs in despite stale APP_URL; unrelated origin and nonce replay rejected.');
} finally {
 const user=await db.user.findUnique({where:{address:account.address.toLowerCase()}});
 if(user)await db.$transaction(async tx=>{
  assert.equal(await tx.execution.count({where:{userId:user.id}}),0);
  await tx.auditLog.deleteMany({where:{userId:user.id}});await tx.session.deleteMany({where:{userId:user.id}});
  await tx.walletIdentity.deleteMany({where:{userId:user.id}});await tx.user.delete({where:{id:user.id}});
 });
 if(nonce)await db.authNonce.deleteMany({where:{nonce:createHash('sha256').update(nonce).digest('hex')}});
 await db.$disconnect();
}
