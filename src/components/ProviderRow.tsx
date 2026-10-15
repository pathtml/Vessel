import { useState } from 'react'
import { ConnectControl } from './ConnectControl'
import { HealthBadge } from './HealthBadge'
import { UsageBar } from './UsageBar'
import { healthAction, signInSteps } from '../lib/format'
import type { UsageSnapshot } from '../types'

interface Props {
  snapshot: UsageSnapshot
  nowMs: number
  onRetry: () => void
  onConnected: () => void
  onDisconnect: (id: string) => void
}

const linkBtn =
  'text-xs font-medium text-sky-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-400'

export function ProviderRow({ snapshot, nowMs, onRetry, onConnected, onDisconnect }: Props) {
  const [showSteps, setShowSteps] = useState(false)
  const dimmed = snapshot.health === 'comingSoon' || snapshot.health === 'notConnected'
  const action = healthAction(snapshot.health)
  const connected = snapshot.health !== 'notConnected' && snapshot.health !== 'comingSoon'

  return (
    <section
      aria-label={snapshot.displayName}
      className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{snapshot.displayName}</h2>
        {connected && (
          <button type="button" onClick={() => onDisconnect(snapshot.provider)} className={linkBtn}>
            Disconnect
          </button>
        )}
      </div>
      <div className={dimmed ? 'opacity-70' : ''}>
        {snapshot.windows.map((w) => (
          <UsageBar key={w.label} window={w} nowMs={nowMs} />
        ))}
        <HealthBadge health={snapshot.health} />
      </div>
      {action === 'connect' && <ConnectControl providerId={snapshot.provider} onDone={onConnected} />}
      {action === 'retry' && (
        <button type="button" onClick={onRetry} className={`mt-2 ${linkBtn}`}>
          Try again
        </button>
      )}
      {action === 'signInHelp' && (
        <div className="mt-2">
          <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps((v) => !v)} className={linkBtn}>
            How to sign in
          </button>
          {showSteps && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{signInSteps(snapshot.provider)}</p>}
        </div>
      )}
    </section>
  )
}

export function ProviderSkeleton() {
  return (
    <div aria-hidden className="animate-pulse rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">
      <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-3 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}
