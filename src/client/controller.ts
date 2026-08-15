/** Settings page state and actions for the Subagents section. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SubagentProfile,
  SubagentProfilePatch,
  SubagentProfilePayload,
} from '../protocol.ts'
import type { SubagentsApi } from './api.ts'

export interface SubagentsSectionState {
  status: 'loading' | 'ready' | 'error'
  profiles: SubagentProfile[]
  error?: string
}

/** Controller over the Subagents settings section. */
export class SubagentsSectionController {
  readonly store: SnapshotStore<SubagentsSectionState>

  constructor(private readonly api: SubagentsApi) {
    this.store = createSnapshotStore<SubagentsSectionState>({ status: 'loading', profiles: [] })
  }

  async load(): Promise<void> {
    this.store.update(draft => { draft.status = 'loading'; draft.error = undefined })
    try {
      const profiles = await this.api.listProfiles()
      this.store.set({ status: 'ready', profiles })
    } catch (error) {
      this.store.set({ status: 'error', profiles: [], error: error instanceof Error ? error.message : String(error) })
    }
  }

  async create(payload: SubagentProfilePayload): Promise<void> {
    const profile = await this.api.createProfile(payload)
    this.store.update(draft => { draft.profiles.push(profile) })
  }

  async update(id: string, patch: SubagentProfilePatch): Promise<void> {
    const profile = await this.api.updateProfile(id, patch)
    this.store.update(draft => {
      const index = draft.profiles.findIndex(entry => entry.id === id)
      if (index >= 0) draft.profiles[index] = profile
    })
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteProfile(id)
    this.store.update(draft => {
      draft.profiles = draft.profiles.filter(entry => entry.id !== id)
    })
  }

  async restoreBuiltins(): Promise<void> {
    const profiles = await this.api.restoreBuiltins()
    this.store.set({ status: 'ready', profiles })
  }
}
