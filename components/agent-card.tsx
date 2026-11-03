'use client';
import Link from 'next/link';
import {ArrowUpRight,Braces,FileText,ChartNoAxesCombined,Terminal,ShieldCheck,ArrowRight} from 'lucide-react';
import {type Agent,formatUsdc} from '@/lib/client';
import {Badge} from './ui';
const icons={summary:FileText,analysis:ChartNoAxesCombined,extraction:Braces};
export function AgentIcon({kind,size=26}:{kind:string;size?:number}){const Icon=icons[kind as keyof typeof icons]||Terminal;return <span className={`agent-icon ${kind}`}><Icon size={size}/></span>;}
export function AgentCard({agent}:{agent:Agent}){return <Link className="agent-card" href={`/agents/${agent.id}`}><div className="agent-card-top"><AgentIcon kind={agent.kind}/><span className="card-arrow"><ArrowUpRight size={19}/></span></div><div className="card-category">{agent.category}<span>·</span>x402 compatible</div><h3>{agent.name}</h3><p>{agent.description}</p><div className="card-provider"><span className="provider-avatar">A</span>{agent.providerName||'Agentra reference services'}{agent.kind&&['summary','analysis','extraction'].includes(agent.kind)&&<ShieldCheck size={14}/>}</div><div className="agent-card-bottom"><div><strong>{formatUsdc(agent.priceUnits)} <span>USDC</span></strong><small>per execution</small></div><Badge tone={agent.status==='APPROVED'||agent.status==='ACTIVE'?'success':'neutral'}>{agent.kind&&['summary','analysis','extraction'].includes(agent.kind)?'Reference service':agent.status.toLowerCase()}</Badge></div></Link>}
