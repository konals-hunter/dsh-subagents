/** Settings page state and actions for the Subagents section. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ModelThinkingConfig,
  ModelThinkingConfigPatch,
  SubagentProfile,
  SubagentProfilePatch,
  SubagentProfilePayload,
} from '../protocol.ts'
import type { SubagentsApi } from './api.ts'

export interface SubagentsSectionState {
  status: 'loading' | 'ready' | 'error'
  profiles: SubagentProfile[]
  thinkingConfigs: ModelThinkingConfig[]
  corrupt?: boolean
  error?: string
}

/** Controller over the Subagents settings section. */
export class SubagentsSectionController {
  readonly store: SnapshotStore<SubagentsSectionState>

  constructor(private readonly api: SubagentsApi) {
    this.store = createSnapshotStore<SubagentsSectionState>({ status: 'loading', profiles: [], thinkingConfigs: [] })
  }

  async load(): Promise<void> {
    this.store.update(draft => { draft.status = 'loading'; draft.error = undefined })
    try {
      const [profiles, configs] = await Promise.all([this.api.listProfiles(), this.api.listThinkingConfigs()])
      this.store.set({ status: 'ready', profiles: profiles.profiles, thinkingConfigs: configs.configs, corrupt: profiles.corrupt })
    } catch (error) {
      this.store.set({ status: 'error', profiles: [], thinkingConfigs: [], error: error instanceof Error ? error.message : String(error) })
    }
  }

  async create(payload: SubagentProfilePayload): Promise<void> {
    const profile = await this.api.createProfile(payload)
    this.store.update(draft => {
      if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
      draft.profiles.push(profile)
      draft.corrupt = false
      draft.error = undefined
    })
  }

  async update(id: string, patch: SubagentProfilePatch): Promise<void> {
    const profile = await this.api.updateProfile(id, patch)
    this.store.update(draft => {
      if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
      const index = draft.profiles.findIndex(entry => entry.id === id)
      if (index >= 0) draft.profiles[index] = profile
      draft.corrupt = false
      draft.error = undefined
    })
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteProfile(id)
    this.store.update(draft => {
      if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
      draft.profiles = draft.profiles.filter(entry => entry.id !== id)
      draft.corrupt = false
      draft.error = undefined
    })
  }

  async restoreBuiltins(): Promise<void> {
    const result = await this.api.restoreBuiltins()
    this.store.update(draft => {
      draft.status = 'ready'
      draft.profiles = result.profiles
      draft.corrupt = result.corrupt
      draft.error = result.error
      if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
    })
  }

  async createThinkingConfig(payload: ModelThinkingConfig): Promise<void> {
    const config = await this.api.createThinkingConfig(payload)
    this.store.update(draft => {
      draft.thinkingConfigs.push(config)
      draft.corrupt = false
      draft.error = undefined
    })
  }

  async updateThinkingConfig(provider: string, model: string, patch: ModelThinkingConfigPatch): Promise<void> {
    const config = await this.api.updateThinkingConfig(provider, model, patch)
    this.store.update(draft => {
      const index = draft.thinkingConfigs.findIndex(item => item.provider === provider && item.model === model)
      if (index >= 0) draft.thinkingConfigs[index] = config
      draft.corrupt = false
      draft.error = undefined
    })
  }

  async deleteThinkingConfig(provider: string, model: string): Promise<void> {
    await this.api.deleteThinkingConfig(provider, model)
    this.store.update(draft => {
      draft.thinkingConfigs = draft.thinkingConfigs.filter(item => !(item.provider === provider && item.model === model))
      draft.corrupt = false
      draft.error = undefined
    })
  }
}
