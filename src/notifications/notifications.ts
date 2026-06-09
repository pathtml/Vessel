import type { AppState } from '../domain/types'
import { formatResetDisplay } from '../domain/reset'
import { getStatusForPercentage, normalizeUsagePeriod } from '../domain/usage'

export async function notifyLowUsage(state: AppState, updateState: (state: AppState) => void) {
  if (!state.settings.notificationsEnabled) return

  const now = new Date()
  let nextState = state

  for (const provider of state.providers) {
    for (const period of provider.supportedPeriods) {
      const snapshot = normalizeUsagePeriod(period)
      if (snapshot.percentageRemaining === undefined) continue
      if (getStatusForPercentage(snapshot.percentageRemaining) === 'green') continue

      const rule = nextState.notificationRules.find((item) => item.providerId === provider.id && item.periodId === period.id)
      if (!rule?.enabled) continue
      if (snapshot.percentageRemaining > rule.thresholdPercent) continue

      const lastNotified = rule.lastNotifiedAt ? new Date(rule.lastNotifiedAt) : null
      const cooldownMs = rule.cooldownMinutes * 60 * 1000
      if (lastNotified && now.getTime() - lastNotified.getTime() < cooldownMs) continue

      await sendNotification(
        `${provider.displayName} ${period.label} usage is low`,
        `${snapshot.percentageRemaining}% remaining. ${formatResetDisplay({
          nextResetAt: period.nextResetAt,
          format: period.resetDisplaySettings.format,
          timezone: period.resetDisplaySettings.timezone,
          use24HourTime: period.resetDisplaySettings.use24HourTime,
        })}.`,
      )

      nextState = {
        ...nextState,
        notificationRules: nextState.notificationRules.map((item) =>
          item.id === rule.id ? { ...item, lastNotifiedAt: now.toISOString() } : item,
        ),
      }
    }
  }

  if (nextState !== state) updateState(nextState)
}

async function sendNotification(title: string, body: string) {
  if (isTauriRuntime()) {
    try {
      const notification = await import('@tauri-apps/plugin-notification')
      const permission = await notification.requestPermission()
      if (permission === 'granted') {
        notification.sendNotification({ title, body })
        return
      }
    } catch {
      // Notification support is optional.
    }
  }

  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
