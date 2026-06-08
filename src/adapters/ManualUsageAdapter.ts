import type { ProviderAdapter, ProviderUsageSnapshot } from './ProviderAdapter'

export class ManualUsageAdapter implements ProviderAdapter {
  id = 'manual'
  label = 'Manual tracking'
  source = 'manual' as const
  supportsOfficialSync = false

  async sync(): Promise<ProviderUsageSnapshot> {
    return {
      source: 'manual',
      limits: [],
      fetchedAt: new Date().toISOString(),
      note: 'Manual providers are updated only by local user actions.',
    }
  }
}
