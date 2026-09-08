'use client'

import { createContext, useContext, useEffect, useState } from 'react'

/** Practice trades the paper ledger; Real signs with the connected wallet. */
export type Mode = 'practice' | 'real'

const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: 'practice', setMode: () => {} })

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('practice')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ph_mode')
      if (saved === 'real' || saved === 'practice') setModeState(saved)
    } catch {
      // storage unavailable; stay in practice
    }
  }, [])
  const setMode = (m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem('ph_mode', m)
    } catch {
      // ignore
    }
  }
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>
}

export const useMode = () => useContext(Ctx)
