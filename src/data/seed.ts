import { createResetRule, getDefaultTimezone } from '../domain/reset'
import type { AppState, LimitUnit, Provider, ProviderPlan, UsageSource } from '../domain/types'

const nowIso = () => new Date().toISOString()

export function createInitialState(): AppState {
  const timezone = getDefaultTimezone()
  const providers = [
    createProvider('ChatGPT', 'Plus', 'manual', 'messages', 160, 42, 'daily', timezone, 25),
    createProvider('Claude', 'Pro', 'manual', 'messages', 45, 12, 'customHours', timezone, 20, 5),
    createProvider('Gemini', 'API', 'manual', 'requests', 1500, 210, 'daily', timezone, 25),
    createProvider('Perplexity', 'Pro', 'manual', 'credits', 600, 126, 'monthly', timezone, 20),
    createProvider('Cursor', 'Pro', 'estimated', 'credits', 20, 6.5, 'monthly', timezone, 25),
    createProvider('Codex', 'Plus', 'estimated', 'requests', 100, 33, 'weekly', timezone, 25),
  ]

  return {
    providers,
    usageRecords: [],
    notificationRules: providers.map((provider) => ({
      id: crypto.randomUUID(),
      providerId: provider.id,
      enabled: true,
      thresholdPercent: provider.models[0]?.limits[0]?.warningThresholdPercent ?? 20,
      cooldownMinutes: 180,
    })),
    settings: {
      openAtLogin: false,
      notificationsEnabled: true,
      privacyNoteAccepted: false,
    },
  }
}

export function createProvider(
  name: string,
  plan: ProviderPlan,
  source: UsageSource,
  unit: LimitUnit,
  maxQuota: number,
  usedQuota: number,
  frequency: 'daily' | 'weekly' | 'monthly' | 'customHours',
  timezone = getDefaultTimezone(),
  warningThresholdPercent = 20,
  customHours?: number,
): Provider {
  const providerId = crypto.randomUUID()
  const modelId = crypto.randomUUID()
  const limitId = crypto.randomUUID()
  const timestamps = nowIso()

  return {
    id: providerId,
    name,
    plan,
    source,
    adapterId: source === 'official' ? `${name.toLowerCase()}-api` : 'manual',
    createdAt: timestamps,
    updatedAt: timestamps,
    models: [
      {
        id: modelId,
        providerId,
        name: 'Default',
        enabled: true,
        limits: [
          {
            id: limitId,
            providerId,
            modelId,
            unit,
            maxQuota,
            usedQuota,
            warningThresholdPercent,
            source,
            resetRule: createResetRule(frequency, timezone, {
              customHours,
              weeklyResetDay: 1,
              monthlyResetDay: 1,
            }),
          },
        ],
      },
    ],
  }
}
