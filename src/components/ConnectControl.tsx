import { useState } from 'react'
import { api } from '../api'
import type { ConnectResult } from '../types'

interface Props {
  providerId: string
  label?: string
  onDone: () => void
}

/**
 * One-click connect. If the provider needs a decision (for example Claude Code already has a
 * different status line) it asks inline instead of overwriting anything.
 */
export function ConnectControl({ providerId, label = 'Connect', onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ConnectResult | null>(null)

  async function run(force: boolean) {
    setBusy(true)
    try {
      const outcome = await api.connectProvider(providerId, force)
      setResult(outcome)
      if (outcome.ok) onDone()
    } catch {
      setResult({ ok: false, status: 'error', message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'rounded-md px-3 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50'

  return (
    <div className="mt-2">
      {result?.status === 'conflict' ? (
        <div role="alert" className="text-xs text-slate-700 dark:text-slate-300">
          <p>{result.message}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(true)} className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}>
              Replace it
            </button>
            <button type="button" onClick={() => setResult(null)} className={`${btn} bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100`}>
              Keep mine
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => run(false)} className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}>
            {busy ? 'Connecting…' : label}
          </button>
          {result && !result.ok && (
            <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {result.message}
            </p>
          )}
        </>
      )}
    </div>
  )
}
