import { useState } from 'react'
import { api } from '../api'
import { ConnectControl } from './ConnectControl'
import type { AppStateDto, DetectState } from '../types'

interface Props {
  state: AppStateDto
  onChanged: () => void
}

type Step = 'notice' | 'providers' | 'finish'

const STATE_LABEL: Record<DetectState, string> = {
  ready: 'Ready to connect',
  needsSignIn: 'Needs sign-in',
  notInstalled: 'Not installed',
  connected: 'Connected',
  comingSoon: 'Coming soon',
}

const primary =
  'rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50'
const secondary =
  'rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-200 dark:hover:bg-slate-700'

export function Onboarding({ state, onChanged }: Props) {
  const [step, setStep] = useState<Step>(state.settings.consentAccepted ? 'providers' : 'notice')
  const [openAtLogin, setOpenAtLogin] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  async function accept() {
    await api.acceptConsent()
    onChanged()
    setStep('providers')
  }

  async function finish() {
    setFinishing(true)
    setError(null)
    try {
      await api.completeOnboarding(openAtLogin)
      onChanged()
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Could not finish setup. Please try again.')
      setFinishing(false)
    }
  }

  const stepNumber = step === 'notice' ? 1 : step === 'providers' ? 2 : 3

  return (
    <main className="flex h-screen flex-col bg-slate-100 p-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
        Step {stepNumber} of 3
      </p>

      {step === 'notice' && (
        <section className="flex flex-1 flex-col">
          <h1 className="mt-1 text-lg font-semibold">Welcome to Vessel</h1>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Vessel shows how much of your AI limits is left, right from the taskbar. Everything stays on this PC.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
            <li>It reads the sign-in files that Codex and Claude Code already saved on this PC.</li>
            <li>For Codex it asks an unofficial ChatGPT page for your usage. That page can change without notice.</li>
            <li>For Claude Code it adds a small status-line hook to your Claude settings. A backup is saved, and you can remove it any time.</li>
            <li>Nothing is sent anywhere except to those providers.</li>
          </ul>
          {state.v1Found && (
            <p className="mt-3 rounded-md bg-sky-100 p-2 text-xs text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
              Found the earlier Ai Usage Dock app. Vessel will take over its Claude hook when you connect.
            </p>
          )}
          <div className="mt-auto flex justify-end">
            <button type="button" onClick={accept} className={primary}>
              I understand, continue
            </button>
          </div>
        </section>
      )}

      {step === 'providers' && (
        <section className="flex flex-1 flex-col">
          <h1 className="mt-1 text-lg font-semibold">Connect your tools</h1>
          <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
            {state.providers.map((p) => (
              <div key={p.id} className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{p.displayName}</h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{STATE_LABEL[p.state]}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.hint}</p>
                {p.state === 'ready' && <ConnectControl providerId={p.id} onDone={onChanged} />}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" onClick={onChanged} className={secondary}>
              Scan again
            </button>
            <button type="button" onClick={() => setStep('finish')} className={primary}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'finish' && (
        <section className="flex flex-1 flex-col">
          <h1 className="mt-1 text-lg font-semibold">Almost done</h1>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={openAtLogin}
              onChange={(e) => setOpenAtLogin(e.target.checked)}
              className="h-4 w-4 accent-sky-600"
            />
            Start Vessel when Windows starts
          </label>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Vessel lives in the tray. Click its icon any time to see what is left. Its colour shows your lowest limit.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between">
            <button type="button" onClick={() => setStep('providers')} className={secondary}>
              Back
            </button>
            <button type="button" disabled={finishing} onClick={finish} className={primary}>
              {finishing ? 'Finishing…' : 'Finish'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
