export type Agent = { id:string; name:string; slug:string; description:string; category:string; priceUnits:string; recipient:string; providerName:string; status:string; kind:string; inputSchema:unknown; outputSchema:unknown; exampleInput:unknown; exampleOutput:unknown; documentation:string; endpointUrl:string; executionCount:number; availability?:string };
export async function api<T=Record<string,unknown>>(path:string, init?:RequestInit):Promise<T> {
  const response=await fetch(path,{...init,headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});
  const data=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if(!response.ok) throw new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||`Request failed (${response.status})`);
  return data as T;
}
export function formatUsdc(units:string|bigint|number='0'):string {
  try { const n=BigInt(units); const negative=n<0n; const v=negative?-n:n; const decimals=(v%1000000n).toString().padStart(6,'0').replace(/0+$/,''); return `${negative?'-':''}${v/1000000n}${decimals?'.'+decimals:'.00'}`; } catch { return '0.00'; }
}
export function shortAddress(address:string) { return `${address.slice(0,6)}…${address.slice(-4)}`; }
export function displayError(error:unknown) {return error instanceof Error?error.message:'Something went wrong. Please try again.';}
