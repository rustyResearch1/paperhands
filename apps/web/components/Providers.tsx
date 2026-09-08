'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { ModeProvider } from '@/lib/mode'
import { wagmiConfig } from '@/lib/wagmi'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } }))
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <ModeProvider>{children}</ModeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
