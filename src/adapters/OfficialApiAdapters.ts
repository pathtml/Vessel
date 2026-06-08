import type { ProviderAdapter, ProviderUsageSnapshot } from './ProviderAdapter'

class PlannedOfficialAdapter implements ProviderAdapter {
  source = 'official' as const
  supportsOfficialSync = true
  id: string
  label: string
  private note: string

  constructor(id: string, label: string, note: string) {
    this.id = id
    this.label = label
    this.note = note
  }

  async sync(): Promise<ProviderUsageSnapshot> {
    return {
      source: 'official',
      limits: [],
      fetchedAt: new Date().toISOString(),
      note: this.note,
    }
  }
}

export const OpenAIApiUsageAdapter = new PlannedOfficialAdapter(
  'openai-api',
  'OpenAI API usage',
  'Planned integration: OpenAI organization usage/cost APIs and API rate-limit headers.',
)

export const ClaudeApiUsageAdapter = new PlannedOfficialAdapter(
  'claude-api',
  'Anthropic API usage',
  'Planned integration: Anthropic Admin usage reports for API usage, not Claude.ai consumer quota.',
)
