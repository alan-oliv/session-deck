import { useEffect, useState } from 'react'
import type { Session, Settings } from '../../shared/api'

// State lives in main: load once, then reload whenever main says it changed.
function useLive<T>(load: () => Promise<T>, subscribe: (cb: () => void) => () => void): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    let seq = 0
    const reload = () => {
      const n = ++seq
      load().then(
        (v) => {
          if (alive && n === seq) setValue(v)
        },
        (e) => console.error(e),
      )
    }
    reload()
    const off = subscribe(reload)
    return () => {
      alive = false
      off()
    }
  }, [])
  return value
}

export const useSessions = (): Session[] | null => useLive(() => window.api.listSessions(), (cb) => window.api.onSessionsChanged(cb))
export const useSettings = (): Settings | null => useLive(() => window.api.getSettings(), (cb) => window.api.onSettingsChanged(cb))

export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('strips Electron’s remote-method prefix from IPC errors', () => {
    expect(errorText(new Error("Error invoking remote method 'api:renameSession': Error: Can't rename a running session"))).toBe("Can't rename a running session")
    expect(errorText('plain')).toBe('plain')
  })
}
