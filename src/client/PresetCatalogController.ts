/**
 * Host-scoped preset catalog controller for the Subagents settings section.
 * Loads `api.agentPresets.list({})` and exposes the preset ids/names through a
 * SnapshotStore so the preset dropdown can render without extra prop drilling.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'

export interface PresetCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  presets: Array<{ id: string; name?: string }>
  error?: string
}

/** Small controller owning the preset catalog snapshot shared by the preset dropdown. */
export class PresetCatalogController {
  readonly store: SnapshotStore<PresetCatalogState> = createSnapshotStore<PresetCatalogState>({
    status: 'idle',
    presets: [],
  })

  constructor(private readonly api: Pick<IApiClient, 'agentPresets'>) {}

  /**
   * Refresh the preset catalog. On failure the previous snapshot (if any) is
   * retained so existing selections stay visible.
   * @returns a promise that settles after the store is updated.
   */
  async load(): Promise<void> {
    this.store.update(draft => {
      draft.status = 'loading'
      draft.error = undefined
    })
    try {
      const { result } = await this.api.agentPresets.list({})
      if (!result.ok) {
        const message = `${result.error.code}: ${result.error.message}`
        this.store.set({
          status: 'error',
          presets: this.store.getSnapshot().presets,
          error: message,
        })
        return
      }
      this.store.set({
        status: 'ready',
        presets: result.value.presets.map(preset => ({ id: preset.id, name: preset.name })),
        error: undefined,
      })
    } catch (error) {
      this.store.set({
        status: 'error',
        presets: this.store.getSnapshot().presets,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
