import type { AppState } from '../domain/types'
import { summarizeProviders } from '../domain/usage'

export async function notifyLowUsage(state: AppState, updateState: (state: AppState) => void) {
  if (!state.settings.notificationsEnabled) return

  const now = new Date()
  const summaries = summarizeProviders(state, now)
  let nextState = state

  for (const summary of summaries) {
    const rule = nextState.notificationRules.find((item) => item.providerId === summary.provider.id)
    if (!rule?.enabled) continue
    if (summary.remainingPercent > rule.thresholdPercent) continue

    const lastNotified = rule.lastNotifiedAt ? new Date(rule.lastNotifiedAt) : null
    const cooldownMs = rule.cooldownMinutes * 60 * 1000
    if (lastNotified && now.getTime() - lastNotified.getTime() < cooldownMs) continue

    await sendNotification(
      `${summary.provider.name} usage is low`,
      `${summary.remainingPercent}% remaining. Next reset: ${new Date(summary.nextResetAt).toLocaleString()}.`,
    )

    nextState = {
      ...nextState,
      notificationRules: nextState.notificationRules.map((item) =>
        item.id === rule.id ? { ...item, lastNotifiedAt: now.toISOString() } : item,
      ),
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
    } catch (error) {
      console.warn('Tauri notification unavailable.', error)
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
