import { healthInfo } from '../lib/format'
import type { Health } from '../types'

const TONES = {
  neutral: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
} as const

export function HealthBadge({ health }: { health: Health }) {
  const info = healthInfo(health)
  if (!info) return null
  return (
    <div className="mt-2">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[info.tone]}`}>
        {info.label}
      </span>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{info.hint}</p>
    </div>
  )
}
