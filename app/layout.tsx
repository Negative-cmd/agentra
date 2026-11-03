import type {Metadata} from 'next';
import {WalletProvider} from '@/components/wallet-provider';
import './globals.css';
export const metadata:Metadata={title:{default:'Agentra — The agent economy starts here',template:'%s | Agentra'},description:'Discover specialized AI services, connect agents, and power machine-to-machine commerce with USDC on Base.',icons:{icon:'/icon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><WalletProvider>{children}</WalletProvider></body></html>;}
