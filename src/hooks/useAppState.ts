import { useCallback, useEffect, useState } from 'react'
import { api, inTauri } from '../api'
import type { AppStateDto } from '../types'

/** Settings and provider detection. Reloads when the backend reports new usage data. */
export function useAppState() {
  const [appState, setAppState] = useState<AppStateDto | null>(null)

  const reload = useCallback(async () => {
    setAppState(await api.getAppState())
  }, [])

  useEffect(() => {
    void reload()
    if (!inTauri) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen('usage_updated', () => void reload())
      if (cancelled) stop()
      else unlisten = stop
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [reload])

  return { appState, reload }
}
