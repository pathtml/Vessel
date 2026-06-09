import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Check, Plus, RotateCcw, Settings, X } from 'lucide-react'
import './App.css'
import { createInitialState, createProvider, createUsagePeriod, PERIOD_LABELS, PROVIDER_OPTIONS } from './data/seed'
import { calculateNextResetAt, formatResetDisplay, getDefaultTimezone } from './domain/reset'
import {
  addUsageToPeriod,
  applyDueResets,
  buildTrayTooltip,
  formatAmount,
  getActiveProvider,
  getDisplayPeriod,
  getSourceBadgeMeta,
  getStatusForPercentage,
  getTrayDisplayState,
  normalizeUsagePeriod,
  resetCurrentPeriod,
} from './domain/usage'
import type {
  AiProvider,
  AppState,
  ProviderKind,
  ResetDisplayFormat,
  ResetRoutineType,
  TooltipSettings,
  UsagePeriod,
  UsagePeriodLabel,
  UsageSourceType,
} from './domain/types'
import { notifyLowUsage } from './notifications/notifications'
import { createStorageDriver, type StorageDriver } from './storage/storage'

const RESET_FORMAT_OPTIONS: Array<{ value: ResetDisplayFormat; label: string }> = [
  { value: 'relative_countdown', label: 'How long until reset' },
  { value: 'time_only', label: 'Exact time' },
  { value: 'date_only', label: 'Date only' },
  { value: 'date_time', label: 'Date + time' },
  { value: 'weekday_date', label: 'Weekday + date' },
  { value: 'custom', label: 'Custom fallback' },
]

const RESET_ROUTINE_OPTIONS: Array<{ value: ResetRoutineType; label: string }> = [
  { value: 'rolling_5h', label: 'Rolling 5h' },
  { value: 'fixed_daily', label: 'Daily fixed time' },
  { value: 'fixed_weekly', label: 'Weekly fixed time' },
  { value: 'fixed_monthly', label: 'Monthly fixed date' },
  { value: 'custom_hours', label: 'Custom hours' },
  { value: 'custom_datetime', label: 'Custom date/time' },
]

interface SetupDraft {
  kind: ProviderKind
  displayName: string
  sourceType: UsageSourceType
  selectedDisplayPeriodId: UsagePeriodLabel
  tooltipPeriodIds: UsagePeriodLabel[]
  timezone: string
  fiveHourLimit?: number
  fiveHourUsed?: number
  weeklyLimit?: number
  weeklyUsed?: number
  resetFormat5h: ResetDisplayFormat
  resetFormatWeekly: ResetDisplayFormat
}

interface LocalUsageWindow {
  label: UsagePeriodLabel
  used_percent: number
  remaining_percent: number
  reset_at?: string
  limit_window_seconds?: number
}

interface LocalUsageResponse {
  status: 'live' | 'unavailable' | 'error'
  source: string
  fetched_at: string
  plan_type?: string
  message?: string
  windows: LocalUsageWindow[]
}

const LOCAL_SYNC_PROVIDER_KINDS: ProviderKind[] = ['chatgpt_codex', 'claude', 'gemini']
const LOCAL_SYNC_COMMANDS: Partial<Record<ProviderKind, string>> = {
  chatgpt_codex: 'sync_codex_usage',
  claude: 'sync_claude_code_usage',
  gemini: 'sync_gemini_usage',
}

const defaultSetupDraft = (): SetupDraft => ({
  kind: 'chatgpt_codex',
  displayName: 'ChatGPT Codex',
  sourceType: 'local',
  selectedDisplayPeriodId: '5h',
  tooltipPeriodIds: ['5h', 'weekly'],
  timezone: getDefaultTimezone(),
  resetFormat5h: 'time_only',
  resetFormatWeekly: 'weekday_date',
})

function App() {
  const [state, setState] = useState<AppState>(() => createInitialState())
  const [storage, setStorage] = useState<StorageDriver | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addUsageOpen, setAddUsageOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [syncingProviderKind, setSyncingProviderKind] = useState<ProviderKind | null>(null)

  const activeProvider = useMemo(() => getActiveProvider(state.providers), [state.providers])
  const activePeriod = useMemo(() => getDisplayPeriod(activeProvider), [activeProvider])
  const trayState = useMemo(() => getTrayDisplayState(state.providers), [state.providers])
  const localSyncKey = useMemo(() => getLocalSyncKinds(state.providers).join('|'), [state.providers])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const driver = await createStorageDriver()
      const saved = await driver.load()
      if (cancelled) return
      setStorage(driver)
      setState(migrateState(saved))
      setLoaded(true)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loaded || !storage) return
    storage.save(state)
  }, [loaded, state, storage])

  useEffect(() => {
    if (!loaded) return
    updateTrayState(trayState)
    notifyLowUsage(state, setState)
  }, [loaded, state, trayState])

  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return
    if (state.settings.openDashboardOnStartup || !state.settings.startMinimizedToTray) {
      invoke('show_dashboard')
    }
  }, [loaded, state.settings.openDashboardOnStartup, state.settings.startMinimizedToTray])

  useEffect(() => {
    if (!loaded) return
    const timer = window.setInterval(() => {
      setState((current) => applyDueResets(current))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [loaded])

  useEffect(() => {
    if (!loaded || !isTauriRuntime() || !localSyncKey) return
    const providerKinds = localSyncKey.split('|') as ProviderKind[]
    async function syncConfiguredLocalUsage() {
      for (const providerKind of providerKinds) {
        const command = LOCAL_SYNC_COMMANDS[providerKind]
        if (!command) continue
        try {
          const response = await invoke<LocalUsageResponse>(command)
          setState((current) => applyLocalUsageSync(current, providerKind, response))
        } catch (error) {
          setState((current) => markLocalSyncFailed(current, providerKind, String(error)))
        }
      }
    }

    void syncConfiguredLocalUsage()
    const timer = window.setInterval(() => {
      void syncConfiguredLocalUsage()
    }, 120_000)
    return () => window.clearInterval(timer)
  }, [localSyncKey, loaded])

  useEffect(() => {
    const unlisten = listen<string>('tray-action', (event) => {
      if (event.payload === 'add-usage') setAddUsageOpen(true)
      if (event.payload === 'settings') setSettingsOpen(true)
      if (event.payload === 'reset-current-period') setState((current) => resetCurrentPeriod(current))
    })
    return () => {
      unlisten.then((dispose) => dispose())
    }
  }, [])

  function saveProvider(provider: AiProvider) {
    setState((current) => {
      const exists = current.providers.some((item) => item.id === provider.id)
      const providers = exists
        ? current.providers.map((item) => (item.id === provider.id ? provider : item))
        : [...current.providers, provider]
      return {
        ...current,
        providers: providers.map((item) => ({ ...item, active: item.id === provider.id })),
        notificationRules: ensureNotificationRules(current.notificationRules, provider),
      }
    })
  }

  function updateProvider(provider: AiProvider) {
    setState((current) => ({
      ...current,
      providers: current.providers.map((item) => (item.id === provider.id ? provider : item)),
    }))
  }

  function setActiveProvider(providerId: string) {
    setState((current) => ({
      ...current,
      providers: current.providers.map((provider) => ({ ...provider, active: provider.id === providerId })),
    }))
  }

  function handleAddUsage(providerId: string, periodId: string, amount: number, note?: string) {
    setState((current) => addUsageToPeriod(current, providerId, periodId, amount, note))
    setAddUsageOpen(false)
  }

  async function syncLocalUsage(providerKind: ProviderKind, showSpinner = true) {
    if (!isTauriRuntime()) return
    const command = LOCAL_SYNC_COMMANDS[providerKind]
    if (!command) return
    if (showSpinner) setSyncingProviderKind(providerKind)
    try {
      const response = await invoke<LocalUsageResponse>(command)
      setState((current) => applyLocalUsageSync(current, providerKind, response))
    } catch (error) {
      setState((current) => markLocalSyncFailed(current, providerKind, String(error)))
    } finally {
      if (showSpinner) setSyncingProviderKind(null)
    }
  }

  if (!loaded) {
    return <Shell><p className="muted">Loading Ai Usage Dock...</p></Shell>
  }

  return (
    <Shell>
      <header className="app-header">
        <div>
          <p className="eyebrow">Windows tray usage dock</p>
          <h1>Ai Usage Dock</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} title="Settings">
          <Settings size={18} />
        </button>
      </header>

      {state.providers.length === 0 ? (
        <FirstTimeSetup onFinish={(provider) => saveProvider(provider)} />
      ) : (
        <Dashboard
          provider={activeProvider}
          activePeriod={activePeriod}
          providers={state.providers}
          onAddUsage={() => setAddUsageOpen(true)}
          onReset={() => setState((current) => resetCurrentPeriod(current))}
          onSettings={() => setSettingsOpen(true)}
          onSetup={() => setSetupOpen(true)}
          onSetActive={setActiveProvider}
          onSyncLocal={(providerKind) => void syncLocalUsage(providerKind)}
          syncingProviderKind={syncingProviderKind}
        />
      )}

      <section className="privacy-note">
        <strong>Local and honest.</strong> No scraping, cookies, passwords, hidden limits, or fake official usage.
      </section>

      {settingsOpen && (
        <SettingsModal
          state={state}
          onClose={() => setSettingsOpen(false)}
          onChange={setState}
          onUpdateProvider={updateProvider}
          onSetActive={setActiveProvider}
        />
      )}
      {addUsageOpen && state.providers.length > 0 && (
        <AddUsageModal
          providers={state.providers}
          defaultProviderId={activeProvider?.id}
          onClose={() => setAddUsageOpen(false)}
          onAdd={handleAddUsage}
        />
      )}
      {setupOpen && (
        <Modal title="Add Provider" onClose={() => setSetupOpen(false)}>
          <FirstTimeSetup
            compact
            onFinish={(provider) => {
              saveProvider(provider)
              setSetupOpen(false)
            }}
          />
        </Modal>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="app-shell">{children}</main>
}

function Dashboard({
  provider,
  activePeriod,
  providers,
  onAddUsage,
  onReset,
  onSettings,
  onSetup,
  onSetActive,
  onSyncLocal,
  syncingProviderKind,
}: {
  provider?: AiProvider
  activePeriod?: UsagePeriod
  providers: AiProvider[]
  onAddUsage: () => void
  onReset: () => void
  onSettings: () => void
  onSetup: () => void
  onSetActive: (providerId: string) => void
  onSyncLocal: (providerKind: ProviderKind) => void
  syncingProviderKind: ProviderKind | null
}) {
  if (!provider) {
    return (
      <section className="empty-state">
        <h2>Setup required</h2>
        <p>Choose provider and limits to start tracking.</p>
        <button type="button" onClick={onSetup}>Start setup</button>
      </section>
    )
  }

  const display = activePeriod ? normalizeUsagePeriod(activePeriod) : undefined

  return (
    <div className="dashboard-grid">
      <section className="hero-panel">
        <p className="eyebrow">Active provider</p>
        <h2>{provider.displayName}</h2>
        <p className="muted">Tray display: {display?.label ?? 'Not configured'} remaining</p>
        <div className={`status-pill ${getStatusForPercentage(display?.percentageRemaining)}`}>
          {display?.percentageRemaining === undefined ? 'Setup required' : `${display.percentageRemaining}% remaining`}
        </div>
        {display && (
          <ProgressBar percentage={display.percentageRemaining} />
        )}
        {display?.limit ? (
          <p>{formatAmount(display.remaining)} / {formatAmount(display.limit)} remaining</p>
        ) : (
          <p className="setup-warning">No limit configured for {provider.displayName} {display?.label ?? ''} period.</p>
        )}
        {display && (
          <p className="muted">
            {formatResetDisplay({
              nextResetAt: display.nextResetAt,
              format: display.resetDisplaySettings.format,
              timezone: display.resetDisplaySettings.timezone,
              use24HourTime: display.resetDisplaySettings.use24HourTime,
            })}
          </p>
        )}
        <div className="button-row">
          {isLocalSyncProvider(provider) && (
            <button type="button" onClick={() => onSyncLocal(provider.kind)} disabled={syncingProviderKind === provider.kind}>
              <RotateCcw size={16} /> {syncingProviderKind === provider.kind ? `Syncing ${getLocalSyncLabel(provider.kind)}` : `Sync ${getLocalSyncLabel(provider.kind)}`}
            </button>
          )}
          <button type="button" onClick={onAddUsage}><Plus size={16} /> Add Usage</button>
          <button type="button" onClick={onReset}><RotateCcw size={16} /> Reset Current Period</button>
          <button type="button" onClick={onSettings}><Settings size={16} /> Settings</button>
        </div>
      </section>

      <section className="panel">
        <h2>Provider</h2>
        <label>
          Active provider
          <select value={provider.id} onChange={(event) => onSetActive(event.target.value)}>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onSetup}>Add provider</button>
      </section>

      <section className="period-list">
        {provider.supportedPeriods.map((period) => (
          <PeriodCard key={period.id} period={period} active={period.id === provider.selectedDisplayPeriodId} />
        ))}
      </section>
    </div>
  )
}

function PeriodCard({ period, active }: { period: UsagePeriod; active?: boolean }) {
  const normalized = normalizeUsagePeriod(period)
  const badge = getSourceBadgeMeta(normalized.sourceType)
  const stateText = getPeriodStateText(normalized)

  return (
    <article className={`period-card ${active ? 'active' : ''}`}>
      <div className="period-card-header">
        <div>
          <h3>{normalized.label}</h3>
          <p className="muted">{stateText.title}</p>
        </div>
        <span className={`source-badge ${normalized.sourceType}`}>{badge.label}</span>
      </div>
      <p>{stateText.body}</p>
      <strong>{normalized.percentageRemaining === undefined ? '--' : normalized.percentageRemaining}%</strong>
      <ProgressBar percentage={normalized.percentageRemaining} />
      <dl>
        <Fact label="Used" value={formatAmount(normalized.used)} />
        <Fact label="Limit" value={formatAmount(normalized.limit)} />
        <Fact
          label="Reset"
          value={formatResetDisplay({
            nextResetAt: normalized.nextResetAt,
            format: normalized.resetDisplaySettings.format,
            timezone: normalized.resetDisplaySettings.timezone,
            use24HourTime: normalized.resetDisplaySettings.use24HourTime,
          })}
        />
      </dl>
    </article>
  )
}

function FirstTimeSetup({ onFinish, compact = false }: { onFinish: (provider: AiProvider) => void; compact?: boolean }) {
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<SetupDraft>(() => defaultSetupDraft())
  const option = PROVIDER_OPTIONS.find((item) => item.kind === draft.kind)
  const canFinish = Boolean(draft.displayName.trim()) && (draft.sourceType === 'local' || draft.fiveHourLimit || draft.weeklyLimit)

  function updateProviderKind(kind: ProviderKind) {
    const next = PROVIDER_OPTIONS.find((item) => item.kind === kind)
    setDraft((current) => ({
      ...current,
      kind,
      displayName: next?.label ?? current.displayName,
      sourceType: next?.sourceType ?? 'manual',
    }))
  }

  function finish() {
    const periods = PERIOD_LABELS.map((label) =>
      createUsagePeriod({
        label,
        sourceType: draft.sourceType,
        limit: label === '5h' ? draft.fiveHourLimit : label === 'weekly' ? draft.weeklyLimit : undefined,
        used: label === '5h' ? draft.fiveHourUsed : label === 'weekly' ? draft.weeklyUsed : undefined,
        timezone: draft.timezone,
        resetDisplayFormat: label === '5h' ? draft.resetFormat5h : label === 'weekly' ? draft.resetFormatWeekly : undefined,
      }),
    )
    onFinish(createProvider({
      kind: draft.kind,
      displayName: draft.displayName.trim(),
      sourceType: draft.sourceType,
      periods,
      selectedDisplayPeriodId: draft.selectedDisplayPeriodId,
      timezone: draft.timezone,
      notes: option?.sourceType === 'official'
        ? 'Only documented official API data may be labeled official. Consumer web subscriptions remain manual unless the provider exposes official usage data.'
        : option?.setupNote ?? 'Manual tracking. Update usage when you use your AI subscription.',
    }))
  }

  return (
    <section className={compact ? 'setup compact' : 'setup'}>
      <div className="setup-header">
        <div>
          <p className="eyebrow">First-time setup</p>
          <h2>Choose what appears in your Windows tray</h2>
        </div>
        <span>{step} / 7</span>
      </div>

      {step === 1 && (
        <SetupStep title="Choose AI provider" helper="Choose the AI subscription you want to monitor.">
          <select value={draft.kind} onChange={(event) => updateProviderKind(event.target.value as ProviderKind)}>
            {PROVIDER_OPTIONS.map((provider) => (
              <option key={provider.kind} value={provider.kind}>{provider.label}</option>
            ))}
          </select>
          <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
          <p className="setup-warning">{option?.setupNote}</p>
        </SetupStep>
      )}

      {step === 2 && (
        <SetupStep title="Choose display period" helper="Choose what you want to see in your Windows tray.">
          <Segmented
            options={['5h', 'daily', 'weekly', 'monthly', 'custom']}
            value={draft.selectedDisplayPeriodId}
            onChange={(value) => setDraft({ ...draft, selectedDisplayPeriodId: value as UsagePeriodLabel })}
          />
        </SetupStep>
      )}

      {step === 3 && (
        <SetupStep title="Set limit" helper="Set the usage limit shown in your AI app. If official sync is unavailable, track it manually.">
          <div className="two-column">
            <NumberField label="5h limit" value={draft.fiveHourLimit} onChange={(value) => setDraft({ ...draft, fiveHourLimit: value })} />
            <NumberField label="5h used" value={draft.fiveHourUsed} onChange={(value) => setDraft({ ...draft, fiveHourUsed: value })} />
            <NumberField label="Weekly limit" value={draft.weeklyLimit} onChange={(value) => setDraft({ ...draft, weeklyLimit: value })} />
            <NumberField label="Weekly used" value={draft.weeklyUsed} onChange={(value) => setDraft({ ...draft, weeklyUsed: value })} />
          </div>
          <label>Timezone<input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label>
        </SetupStep>
      )}

      {step === 4 && (
        <SetupStep title="Choose tray display" helper="Pick the period whose percentage appears in the tray icon.">
          <Segmented
            options={['5h', 'weekly', 'custom']}
            value={draft.selectedDisplayPeriodId}
            onChange={(value) => setDraft({ ...draft, selectedDisplayPeriodId: value as UsagePeriodLabel })}
          />
        </SetupStep>
      )}

      {step === 5 && (
        <SetupStep title="Choose next reset display" helper="Choose how reset time is shown in dashboard and tooltip.">
          <label>5h reset display<ResetFormatSelect value={draft.resetFormat5h} onChange={(value) => setDraft({ ...draft, resetFormat5h: value })} /></label>
          <label>Weekly reset display<ResetFormatSelect value={draft.resetFormatWeekly} onChange={(value) => setDraft({ ...draft, resetFormatWeekly: value })} /></label>
        </SetupStep>
      )}

      {step === 6 && (
        <SetupStep title="Choose tooltip fields" helper="Choose which periods appear when you hover over the tray icon.">
          <Checkbox
            label="5h remaining and next reset"
            checked={draft.tooltipPeriodIds.includes('5h')}
            onChange={(checked) => setDraft({ ...draft, tooltipPeriodIds: toggleValue(draft.tooltipPeriodIds, '5h', checked) })}
          />
          <Checkbox
            label="Weekly remaining and next reset"
            checked={draft.tooltipPeriodIds.includes('weekly')}
            onChange={(checked) => setDraft({ ...draft, tooltipPeriodIds: toggleValue(draft.tooltipPeriodIds, 'weekly', checked) })}
          />
        </SetupStep>
      )}

      {step === 7 && (
        <SetupStep title="Finish" helper="Save this provider and keep Ai Usage Dock running quietly in the tray.">
          <PreviewProvider draft={draft} />
        </SetupStep>
      )}

      <div className="modal-actions">
        <button type="button" disabled={step === 1} onClick={() => setStep((value) => Math.max(1, value - 1))}>Back</button>
        {step < 7 ? (
          <button type="button" onClick={() => setStep((value) => Math.min(7, value + 1))}>Next</button>
        ) : (
          <button type="button" disabled={!canFinish} onClick={finish}><Check size={16} /> Finish setup</button>
        )}
      </div>
    </section>
  )
}

function SettingsModal({
  state,
  onChange,
  onClose,
  onUpdateProvider,
  onSetActive,
}: {
  state: AppState
  onChange: (state: AppState) => void
  onClose: () => void
  onUpdateProvider: (provider: AiProvider) => void
  onSetActive: (providerId: string) => void
}) {
  const activeProvider = getActiveProvider(state.providers)
  const [selectedProviderId, setSelectedProviderId] = useState(activeProvider?.id ?? state.providers[0]?.id ?? '')
  const provider = state.providers.find((item) => item.id === selectedProviderId) ?? activeProvider

  function updateSettings(settings: Partial<AppState['settings']>) {
    if (settings.openAtLogin !== undefined && isTauriRuntime()) {
      invoke('set_open_at_login', { enabled: settings.openAtLogin }).catch(() => undefined)
    }
    onChange({ ...state, settings: { ...state.settings, ...settings } })
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h3>Startup behavior</h3>
        <Checkbox label="Start with Windows" checked={state.settings.openAtLogin} onChange={(checked) => updateSettings({ openAtLogin: checked })} />
        <Checkbox label="Open dashboard on startup" checked={state.settings.openDashboardOnStartup} onChange={(checked) => updateSettings({ openDashboardOnStartup: checked })} />
        <Checkbox label="Start minimized to tray" checked={state.settings.startMinimizedToTray} onChange={(checked) => updateSettings({ startMinimizedToTray: checked })} />
        <Checkbox label="Notifications" checked={state.settings.notificationsEnabled} onChange={(checked) => updateSettings({ notificationsEnabled: checked })} />
      </section>

      {provider && (
        <section className="settings-section">
          <h3>Tray provider</h3>
          <label>
            Active provider
            <select
              value={provider.id}
              onChange={(event) => {
                setSelectedProviderId(event.target.value)
                onSetActive(event.target.value)
              }}
            >
              {state.providers.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
          </label>
          <ProviderSettings provider={provider} onChange={onUpdateProvider} />
        </section>
      )}
    </Modal>
  )
}

function ProviderSettings({ provider, onChange }: { provider: AiProvider; onChange: (provider: AiProvider) => void }) {
  function updatePeriod(periodId: string, patch: Partial<UsagePeriod>) {
    const nextProvider = {
      ...provider,
      supportedPeriods: provider.supportedPeriods.map((period) => {
        if (period.id !== periodId) return period
        const merged = normalizeUsagePeriod({ ...period, ...patch })
        return {
          ...merged,
          nextResetAt: patch.resetRoutine
            ? calculateNextResetAt(patch.resetRoutine, new Date(), period.nextResetAt)
            : merged.nextResetAt,
        }
      }),
      lastUpdatedAt: new Date().toISOString(),
    }
    onChange(nextProvider)
  }

  function updateTooltipSettings(patch: Partial<TooltipSettings>) {
    onChange({ ...provider, tooltipSettings: { ...provider.tooltipSettings, ...patch } })
  }

  return (
    <div className="settings-stack">
      <label>
        Display period
        <select value={provider.selectedDisplayPeriodId} onChange={(event) => onChange({ ...provider, selectedDisplayPeriodId: event.target.value })}>
          {provider.supportedPeriods.map((period) => (
            <option key={period.id} value={period.id}>{period.label}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Tooltip periods</legend>
        {provider.supportedPeriods.map((period) => (
          <Checkbox
            key={period.id}
            label={period.label}
            checked={provider.tooltipPeriodIds.includes(period.id)}
            onChange={(checked) => onChange({ ...provider, tooltipPeriodIds: toggleValue(provider.tooltipPeriodIds, period.id, checked) })}
          />
        ))}
      </fieldset>

      <fieldset>
        <legend>Tooltip fields</legend>
        <Checkbox label="Percentage" checked={provider.tooltipSettings.showPercentage} onChange={(checked) => updateTooltipSettings({ showPercentage: checked })} />
        <Checkbox label="Remaining amount" checked={provider.tooltipSettings.showRemaining} onChange={(checked) => updateTooltipSettings({ showRemaining: checked })} />
        <Checkbox label="Next reset" checked={provider.tooltipSettings.showNextReset} onChange={(checked) => updateTooltipSettings({ showNextReset: checked })} />
        <Checkbox label="Source type" checked={provider.tooltipSettings.showSourceType} onChange={(checked) => updateTooltipSettings({ showSourceType: checked })} />
        <Checkbox label="Last updated" checked={provider.tooltipSettings.showLastUpdated} onChange={(checked) => updateTooltipSettings({ showLastUpdated: checked })} />
      </fieldset>

      {provider.supportedPeriods.map((period) => (
        <PeriodSettings key={period.id} period={period} onChange={(patch) => updatePeriod(period.id, patch)} />
      ))}
    </div>
  )
}

function PeriodSettings({ period, onChange }: { period: UsagePeriod; onChange: (patch: Partial<UsagePeriod>) => void }) {
  return (
    <section className="period-settings">
      <h4>{period.label} limits</h4>
      <div className="two-column">
        <NumberField label="Limit amount" value={period.limit} onChange={(value) => onChange({ limit: value, setupConfirmed: Boolean(value) })} />
        <NumberField label="Used amount" value={period.used} onChange={(value) => onChange({ used: value ?? 0, setupConfirmed: true })} />
      </div>
      <label>
        Reset format
        <ResetFormatSelect
          value={period.resetDisplaySettings.format}
          onChange={(format) => onChange({ resetDisplaySettings: { ...period.resetDisplaySettings, format } })}
        />
      </label>
      <div className="two-column">
        <label>
          Timezone
          <input
            value={period.resetDisplaySettings.timezone}
            onChange={(event) => onChange({
              resetDisplaySettings: { ...period.resetDisplaySettings, timezone: event.target.value },
              resetRoutine: { ...period.resetRoutine, timezone: event.target.value },
            })}
          />
        </label>
        <label>
          Time format
          <select
            value={period.resetDisplaySettings.use24HourTime ? '24' : '12'}
            onChange={(event) => onChange({ resetDisplaySettings: { ...period.resetDisplaySettings, use24HourTime: event.target.value === '24' } })}
          >
            <option value="24">24-hour</option>
            <option value="12">12-hour</option>
          </select>
        </label>
      </div>
      <label>
        Reset routine
        <select
          value={period.resetRoutine.type}
          onChange={(event) => onChange({ resetRoutine: { ...period.resetRoutine, type: event.target.value as ResetRoutineType } })}
        >
          {RESET_ROUTINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="two-column">
        <NumberField
          label="Reset hour"
          value={period.resetRoutine.resetHour}
          onChange={(value) => onChange({ resetRoutine: { ...period.resetRoutine, resetHour: value } })}
        />
        <NumberField
          label="Reset minute"
          value={period.resetRoutine.resetMinute}
          onChange={(value) => onChange({ resetRoutine: { ...period.resetRoutine, resetMinute: value } })}
        />
        <NumberField
          label="Weekly reset day"
          value={period.resetRoutine.weeklyResetDay}
          onChange={(value) => onChange({ resetRoutine: { ...period.resetRoutine, weeklyResetDay: value } })}
        />
        <NumberField
          label="Monthly reset day"
          value={period.resetRoutine.monthlyResetDay}
          onChange={(value) => onChange({ resetRoutine: { ...period.resetRoutine, monthlyResetDay: value } })}
        />
        <NumberField
          label="Custom interval hours"
          value={period.resetRoutine.intervalHours}
          onChange={(value) => onChange({ resetRoutine: { ...period.resetRoutine, intervalHours: value } })}
        />
        <label>
          Custom reset datetime
          <input
            type="datetime-local"
            value={toDatetimeLocal(period.resetRoutine.customResetAt)}
            onChange={(event) => onChange({
              resetRoutine: {
                ...period.resetRoutine,
                customResetAt: event.target.value ? new Date(event.target.value).toISOString() : undefined,
              },
              nextResetAt: event.target.value ? new Date(event.target.value).toISOString() : period.nextResetAt,
            })}
          />
        </label>
      </div>
    </section>
  )
}

function AddUsageModal({
  providers,
  defaultProviderId,
  onClose,
  onAdd,
}: {
  providers: AiProvider[]
  defaultProviderId?: string
  onClose: () => void
  onAdd: (providerId: string, periodId: string, amount: number, note?: string) => void
}) {
  const [providerId, setProviderId] = useState(defaultProviderId ?? providers[0]?.id ?? '')
  const provider = providers.find((item) => item.id === providerId) ?? providers[0]
  const [periodId, setPeriodId] = useState(provider?.selectedDisplayPeriodId ?? provider?.supportedPeriods[0]?.id ?? '')
  const selectedPeriodId = provider?.supportedPeriods.some((period) => period.id === periodId)
    ? periodId
    : provider?.selectedDisplayPeriodId ?? provider?.supportedPeriods[0]?.id ?? ''
  const [amount, setAmount] = useState<number | undefined>()
  const [note, setNote] = useState('')

  return (
    <Modal title="Add Usage" onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!providerId || !selectedPeriodId || !amount) return
          onAdd(providerId, selectedPeriodId, amount, note.trim() || undefined)
        }}
      >
        <label>
          Provider
          <select
            value={providerId}
            onChange={(event) => {
              const nextProvider = providers.find((item) => item.id === event.target.value)
              setProviderId(event.target.value)
              setPeriodId(nextProvider?.selectedDisplayPeriodId ?? nextProvider?.supportedPeriods[0]?.id ?? '')
            }}
          >
            {providers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
        </label>
        <label>
          Period
          <select value={selectedPeriodId} onChange={(event) => setPeriodId(event.target.value)}>
            {provider?.supportedPeriods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
          </select>
        </label>
        <NumberField label="Amount used" value={amount} onChange={setAmount} />
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Add usage</button>
        </div>
      </form>
    </Modal>
  )
}

function SetupStep({ title, helper, children }: { title: string; helper: string; children: React.ReactNode }) {
  return (
    <div className="setup-step">
      <h3>{title}</h3>
      <p>{helper}</p>
      <div className="settings-stack">{children}</div>
    </div>
  )
}

function PreviewProvider({ draft }: { draft: SetupDraft }) {
  return (
    <div className="preview-box">
      <Fact label="Provider" value={draft.displayName} />
      <Fact label="Tray display" value={`${draft.selectedDisplayPeriodId} remaining`} />
      <Fact label="5h limit" value={formatAmount(draft.fiveHourLimit)} />
      <Fact label="Weekly limit" value={formatAmount(draft.weeklyLimit)} />
      <Fact label="Source" value={getSourceBadgeMeta(draft.sourceType).label} />
    </div>
  )
}

function ProgressBar({ percentage }: { percentage?: number }) {
  return (
    <div className="progress-track">
      <span style={{ width: `${percentage ?? 0}%` }} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function NumberField({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </label>
  )
}

function ResetFormatSelect({ value, onChange }: { value: ResetDisplayFormat; onChange: (value: ResetDisplayFormat) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as ResetDisplayFormat)}>
      {RESET_FORMAT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option} type="button" className={option === value ? 'active' : ''} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function getPeriodStateText(period: UsagePeriod) {
  if (!period.limit) {
    return {
      title: 'Setup required',
      body: 'Choose provider and limits to start tracking.',
    }
  }
  if (period.sourceType === 'manual') {
    return {
      title: 'Manual tracking',
      body: 'Update usage when you use your AI subscription.',
    }
  }
  if (period.sourceType === 'estimated') {
    return {
      title: 'Estimated',
      body: 'Usage is estimated from activity this app can see.',
    }
  }
  if (period.sourceType === 'local') {
    return {
      title: 'Local sync',
      body: 'Usage is synced from a supported local provider session.',
    }
  }
  if (period.sourceType === 'official') {
    return {
      title: 'Official',
      body: 'Usage is synced from an official provider API.',
    }
  }
  return {
    title: 'Official tracking unavailable',
    body: 'Use manual tracking instead.',
  }
}

function toggleValue<T>(items: T[], value: T, enabled: boolean) {
  if (enabled && !items.includes(value)) return [...items, value]
  if (!enabled) return items.filter((item) => item !== value)
  return items
}

function toDatetimeLocal(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function ensureNotificationRules(existing: AppState['notificationRules'], provider: AiProvider) {
  const next = [...existing]
  for (const period of provider.supportedPeriods) {
    if (next.some((rule) => rule.providerId === provider.id && rule.periodId === period.id)) continue
    next.push({
      id: crypto.randomUUID(),
      providerId: provider.id,
      periodId: period.id,
      enabled: true,
      thresholdPercent: provider.warningThresholdPercent,
      cooldownMinutes: 180,
    })
  }
  return next
}

function migrateState(saved: AppState | null): AppState {
  if (!saved || !Array.isArray(saved.providers)) return createInitialState()
  if (saved.providers.some((provider) => !('supportedPeriods' in provider))) {
    return createInitialState()
  }
  const initial = createInitialState()
  return {
    ...initial,
    ...saved,
    providers: saved.providers.map(enforceSupportedSources),
    settings: {
      ...initial.settings,
      ...saved.settings,
    },
  }
}

function enforceSupportedSources(provider: AiProvider): AiProvider {
  if (provider.sourceType !== 'official' && provider.supportedPeriods.every((period) => period.sourceType !== 'official')) {
    return provider
  }

  return {
    ...provider,
    sourceType: provider.sourceType === 'official' ? 'manual' : provider.sourceType,
    supportedPeriods: provider.supportedPeriods.map((period) => ({
      ...period,
      sourceType: period.sourceType === 'official' ? 'manual' : period.sourceType,
    })),
    notes: 'Official/local subscription status is not available in this build. Manual setup is used.',
  }
}

function getLocalSyncKinds(providers: AiProvider[]) {
  return LOCAL_SYNC_PROVIDER_KINDS.filter((kind) =>
    providers.some((provider) => provider.kind === kind && provider.sourceType === 'local'),
  )
}

function isLocalSyncProvider(provider: AiProvider) {
  return provider.sourceType === 'local' && LOCAL_SYNC_PROVIDER_KINDS.includes(provider.kind)
}

function getLocalSyncLabel(providerKind: ProviderKind) {
  if (providerKind === 'chatgpt_codex') return 'Codex'
  if (providerKind === 'claude') return 'Claude'
  if (providerKind === 'gemini') return 'Gemini'
  return 'Local'
}

function applyLocalUsageSync(state: AppState, providerKind: ProviderKind, response: LocalUsageResponse): AppState {
  if (response.status !== 'live' || response.windows.length === 0) {
    return markLocalSyncFailed(state, providerKind, response.message ?? `${getLocalSyncLabel(providerKind)} usage sync is unavailable.`)
  }

  return {
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.kind !== providerKind || provider.sourceType !== 'local') return provider
      const periods = mergeLocalWindows(provider.supportedPeriods, response)
      return {
        ...provider,
        sourceType: 'local',
        supportedPeriods: periods,
        selectedDisplayPeriodId: provider.selectedDisplayPeriodId || periods[0]?.id || response.windows[0]?.label || '5h',
        tooltipPeriodIds: periods
          .filter((period) => period.label === '5h' || period.label === 'daily' || period.label === 'weekly')
          .map((period) => period.id),
        hasCredential: true,
        lastUpdatedAt: response.fetched_at,
        notes: `${getLocalSyncLabel(providerKind)} local sync${response.plan_type ? ` (${response.plan_type})` : ''}.`,
      }
    }),
  }
}

function markLocalSyncFailed(state: AppState, providerKind: ProviderKind, message: string): AppState {
  const now = new Date().toISOString()
  return {
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.kind !== providerKind || provider.sourceType !== 'local') return provider
      return {
        ...provider,
        lastUpdatedAt: provider.lastUpdatedAt ?? now,
        notes: `${getLocalSyncLabel(providerKind)} local sync stale: ${message}`,
      }
    }),
  }
}

function mergeLocalWindows(existingPeriods: UsagePeriod[], response: LocalUsageResponse) {
  let periods = [...existingPeriods]
  for (const window of response.windows) {
    if (!PERIOD_LABELS.includes(window.label)) continue
    const existing = periods.find((period) => period.label === window.label)
    const base = existing ?? createUsagePeriod({ label: window.label, sourceType: 'local' })
    const next = normalizeUsagePeriod({
      ...base,
      sourceType: 'local',
      limit: 100,
      used: Math.max(0, Math.min(100, window.used_percent)),
      nextResetAt: window.reset_at ?? base.nextResetAt,
      setupConfirmed: true,
    })

    periods = existing
      ? periods.map((period) => (period.id === existing.id ? next : period))
      : [...periods, next]
  }

  const order: Record<UsagePeriodLabel, number> = {
    '5h': 1,
    daily: 2,
    weekly: 3,
    monthly: 4,
    custom: 5,
  }
  return periods.sort((a, b) => order[a.label] - order[b.label])
}

async function updateTrayState(trayState: ReturnType<typeof getTrayDisplayState>) {
  if (!isTauriRuntime()) return
  try {
    await invoke('update_tray_state', {
      percentage: trayState.percentage,
      status: trayState.status,
      tooltip: trayState.tooltip || buildTrayTooltip(trayState.activeProvider),
    })
  } catch {
    // Tray APIs are unavailable in browser preview.
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export default App
