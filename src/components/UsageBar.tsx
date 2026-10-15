import { toneFor, windowTitle, formatReset } from '../lib/format'
import type { UsageWindow } from '../types'

const FILL = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
} as const

export function UsageBar({ window, nowMs }: { window: UsageWindow; nowMs: number }) {
  const tone = toneFor(window.remainingPct)
  const reset = formatReset(window.resetsAt, nowMs)
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between text-xs text-slate-600 dark:text-slate-400">
        <span>{windowTitle(window.label)}</span>
        <span>
          <strong className="text-sm text-slate-900 dark:text-slate-100">{window.remainingPct}%</strong> left
          {reset && <> · resets in {reset}</>}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${windowTitle(window.label)} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.remainingPct}
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${FILL[tone]}`}
          style={{ width: `${window.remainingPct}%` }}
        />
      </div>
    </div>
  )
}
