import { useState } from 'react'
import { api } from '../api'
import { ConnectControl } from './ConnectControl'
import type { AppStateDto, Settings } from '../types'

interface Props {
  state: AppStateDto
  onChanged: () => void
}

const card = 'rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800'
const heading = 'mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
const select =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'
const link =
  'text-xs font-medium text-sky-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-400'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

export function SettingsView({ state, onChanged }: Props) {
  const [draft, setDraft] = useState<Settings>(state.settings)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  /** Every change saves right away, so there is no Save button to forget. */
  async function update(patch: Partial<Settings>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    try {
      setDraft(await api.saveSettings(next))
      setError(null)
      setStatus('saved')
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Could not save. Please try again.')
      setStatus('error')
    }
  }

  const quietOn = draft.quietStart !== null && draft.quietEnd !== null

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Vessel settings</h1>
        <span aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
          {status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <h2 className={heading}>Providers</h2>
      <div className="space-y-2">
        {state.providers.map((p) => (
          <div key={p.id} className={card}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{p.displayName}</span>
              {p.state === 'connected' && (
                <button
                  type="button"
                  className={link}
                  onClick={async () => {
                    await api.disconnectProvider(p.id)
                    onChanged()
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.hint}</p>
            {p.state === 'ready' && <ConnectControl providerId={p.id} onDone={onChanged} />}
          </div>
        ))}
      </div>

      <h2 className={heading}>Alerts</h2>
      <div className={`${card} space-y-3`}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-600"
            checked={draft.alertsEnabled}
            onChange={(e) => update({ alertsEnabled: e.target.checked })}
          />
          Notify me when a limit is running low or resets
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Warn me at</span>
          <select
            className={select}
            disabled={!draft.alertsEnabled}
            value={draft.lowThreshold}
            onChange={(e) => update({ lowThreshold: Number(e.target.value) })}
          >
            {[10, 20, 30, 40, 50].map((v) => (
              <option key={v} value={v}>
                {v}% left
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">You also get a second warning at 5% left.</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-600"
            checked={quietOn}
            disabled={!draft.alertsEnabled}
            onChange={(e) =>
              update(e.target.checked ? { quietStart: 22, quietEnd: 7 } : { quietStart: null, quietEnd: null })
            }
          />
          Quiet hours (no pop-ups)
        </label>
        {quietOn && (
          <div className="flex items-center gap-2 text-sm">
            <select
              aria-label="Quiet hours start"
              className={select}
              value={draft.quietStart ?? 22}
              onChange={(e) => update({ quietStart: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              aria-label="Quiet hours end"
              className={select}
              value={draft.quietEnd ?? 7}
              onChange={(e) => update({ quietEnd: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">The tray icon colour still updates during quiet hours.</p>
      </div>

      <h2 className={heading}>General</h2>
      <div className={`${card} space-y-3`}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-600"
            checked={draft.openAtLogin}
            onChange={(e) => update({ openAtLogin: e.target.checked })}
          />
          Start Vessel when Windows starts
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Check usage every</span>
          <select
            className={select}
            value={draft.refreshMinutes}
            onChange={(e) => update({ refreshMinutes: Number(e.target.value) })}
          >
            {[1, 5, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2 className={heading}>About</h2>
      <div className={`${card} text-xs text-slate-600 dark:text-slate-400`}>
        <p>Vessel 0.1.0</p>
        <p className="mt-1">
          Everything stays on this PC. Vessel only talks to the providers you connect, using the sign-in files already
          saved by their tools. Codex numbers come from an unofficial page that can change without notice.
        </p>
      </div>
    </main>
  )
}
