import { useCallback, useEffect, useState } from 'react'
import type { UsageSnapshot } from '../types'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Sample data so the UI can be opened in a plain browser during development. */
const MOCK: UsageSnapshot[] = [
  {
    provider: 'codex',
    displayName: 'Codex',
    windows: [
      { label: '5h', usedPct: 20, remainingPct: 80, resetsAt: Math.floor(Date.now() / 1000) + 7800 },
      { label: 'weekly', usedPct: 88, remainingPct: 12, resetsAt: Math.floor(Date.now() / 1000) + 3 * 86400 },
    ],
    fetchedAt: Math.floor(Date.now() / 1000) - 60,
    health: 'ok',
    message: null,
  },
  {
    provider: 'claude',
    displayName: 'Claude',
    windows: [],
    fetchedAt: Math.floor(Date.now() / 1000),
    health: 'notConnected',
    message: null,
  },
  {
    provider: 'gemini',
    displayName: 'Gemini',
    windows: [],
    fetchedAt: Math.floor(Date.now() / 1000),
    health: 'comingSoon',
    message: null,
  },
]

/** Cached snapshots arrive instantly; live updates stream in as events from Rust. */
export function useSnapshots() {
  const [snapshots, setSnapshots] = useState<UsageSnapshot[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!inTauri) {
      setSnapshots(MOCK)
      return
    }
    let unlisten: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const { listen } = await import('@tauri-apps/api/event')
      const cached = await invoke<UsageSnapshot[]>('get_snapshots')
      if (!cancelled) setSnapshots(cached)
      const stop = await listen<UsageSnapshot[]>('usage_updated', (event) => {
        setSnapshots(event.payload)
        setRefreshing(false)
      })
      if (cancelled) stop()
      else unlisten = stop
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!inTauri) return
    setRefreshing(true)
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('refresh')
    // Safety net: never leave the spinner stuck if no event arrives.
    setTimeout(() => setRefreshing(false), 15000)
  }, [])

  return { snapshots, refreshing, refresh }
}

/** Re-renders on an interval so countdowns and "updated X ago" stay fresh. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
