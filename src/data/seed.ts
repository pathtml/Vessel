import { calculateNextResetAt, createResetDisplaySettings, createResetRoutine, getDefaultTimezone } from '../domain/reset'
import { normalizeUsagePeriod } from '../domain/usage'
import type {
  AiProvider,
  AppState,
  ProviderKind,
  ResetDisplayFormat,
  UsagePeriod,
  UsagePeriodLabel,
  UsageSourceType,
} from '../domain/types'

export interface ProviderOption {
  kind: ProviderKind
  label: string
  sourceType: UsageSourceType
  setupNote: string
}

const manualSetupNote = 'Official/local subscription status is not available in this build. Use manual setup.'
const codexLocalSetupNote = 'Codex can sync 5h and weekly limits from your existing local Codex CLI login.'
const claudeLocalSetupNote = 'Claude Code can sync 5h and weekly limits from its official local status-line data after setup.'
const geminiLocalSetupNote = 'Gemini can sync local quota data from a Gemini CLI quota export when available.'

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { kind: 'chatgpt', label: 'ChatGPT', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'chatgpt_codex', label: 'ChatGPT Codex', sourceType: 'local', setupNote: codexLocalSetupNote },
  { kind: 'claude', label: 'Claude', sourceType: 'local', setupNote: claudeLocalSetupNote },
  { kind: 'gemini', label: 'Gemini', sourceType: 'local', setupNote: geminiLocalSetupNote },
  { kind: 'perplexity', label: 'Perplexity', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'cursor', label: 'Cursor', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'github_copilot', label: 'GitHub Copilot', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'openai_api', label: 'OpenAI API', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'claude_api', label: 'Claude API', sourceType: 'manual', setupNote: manualSetupNote },
  { kind: 'custom', label: 'Custom provider', sourceType: 'manual', setupNote: manualSetupNote },
]

export const PERIOD_LABELS: UsagePeriodLabel[] = ['5h', 'daily', 'weekly', 'monthly', 'custom']

export function createInitialState(): AppState {
  const timezone = getDefaultTimezone()
  return {
    providers: [],
    usageRecords: [],
    credentials: [],
    notificationRules: [],
    settings: {
      openAtLogin: false,
      openDashboardOnStartup: false,
      startMinimizedToTray: true,
      notificationsEnabled: true,
      privacyNoteAccepted: false,
      defaultTimezone: timezone,
    },
  }
}

export function createUsagePeriod(options: {
  id?: string
  label: UsagePeriodLabel
  sourceType?: UsageSourceType
  limit?: number
  used?: number
  timezone?: string
  setupConfirmed?: boolean
  resetDisplayFormat?: ResetDisplayFormat
}): UsagePeriod {
  const timezone = options.timezone ?? getDefaultTimezone()
  const id = options.id ?? options.label
  const resetRoutine = createResetRoutine(options.label, timezone)
  const resetDisplaySettings = createResetDisplaySettings(id, options.label, timezone)
  const period = normalizeUsagePeriod({
    id,
    label: options.label,
    limit: options.limit,
    used: options.used,
    resetRoutine,
    resetDisplaySettings: {
      ...resetDisplaySettings,
      format: options.resetDisplayFormat ?? resetDisplaySettings.format,
    },
    nextResetAt: calculateNextResetAt(resetRoutine),
    sourceType: options.sourceType ?? 'manual',
    setupConfirmed: options.setupConfirmed ?? Boolean(options.limit),
  })

  return period
}

export function createProvider(options: {
  kind: ProviderKind
  displayName: string
  sourceType?: UsageSourceType
  active?: boolean
  selectedDisplayPeriodId?: string
  periods?: UsagePeriod[]
  timezone?: string
  notes?: string
}): AiProvider {
  const now = new Date().toISOString()
  const timezone = options.timezone ?? getDefaultTimezone()
  const sourceType = options.sourceType ?? 'manual'
  const periods = options.periods ?? [
    createUsagePeriod({ label: '5h', sourceType, timezone }),
    createUsagePeriod({ label: 'weekly', sourceType, timezone }),
  ]
  const selectedDisplayPeriodId = options.selectedDisplayPeriodId ?? periods.find((period) => period.label === '5h')?.id ?? periods[0]?.id ?? '5h'

  return {
    id: crypto.randomUUID(),
    name: options.displayName,
    displayName: options.displayName,
    kind: options.kind,
    enabled: true,
    active: options.active ?? true,
    sourceType,
    supportedPeriods: periods,
    selectedDisplayPeriodId,
    tooltipPeriodIds: periods.filter((period) => period.label === '5h' || period.label === 'weekly').map((period) => period.id),
    tooltipSettings: {
      showPercentage: true,
      showRemaining: false,
      showNextReset: true,
      showSourceType: true,
      showLastUpdated: true,
    },
    warningThresholdPercent: 20,
    createdAt: now,
    lastUpdatedAt: now,
    notes: options.notes,
  }
}
