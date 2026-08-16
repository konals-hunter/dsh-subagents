/**
 * Host-scoped model catalog controller for the Subagents settings section.
 * Loads `api.llm.models({})` and exposes the provider groups through a
 * SnapshotStore so the unified ModelSelect can render provider-grouped model
 * rows without requiring a provider-first selection step.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  IApiClient,
  ModelCatalogFailure,
  ModelProviderGroup,
} from '@deepseek-ai/dsh-api-remotes/client'

export interface ModelCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  groups: readonly ModelProviderGroup[]
  failures: readonly ModelCatalogFailure[]
  error?: string
}

/** Small controller owning the catalog snapshot shared by every ModelSelect. */
export class ModelCatalogController {
  readonly store: SnapshotStore<ModelCatalogState> = createSnapshotStore<ModelCatalogState>({
    status: 'idle',
    groups: [],
    failures: [],
  })

  constructor(private readonly api: Pick<IApiClient, 'llm'>) {}

  /**
   * Refresh the host model catalog. A failed whole-request load keeps the last
   * good groups so existing selections stay visible.
   * @returns a promise that settles after the store is updated.
   */
  async load(): Promise<void> {
    this.store.update(draft => {
      draft.status = 'loading'
      draft.error = undefined
    })
    try {
      const { result } = await this.api.llm.models({})
      if (!result.ok) {
        const message = `${result.error.code}: ${result.error.message}`
        this.store.set({
          status: 'error',
          groups: this.store.getSnapshot().groups,
          failures: this.store.getSnapshot().failures,
          error: message,
        })
        return
      }
      this.store.set({
        status: 'ready',
        groups: result.value.groups,
        failures: result.value.failures,
        error: undefined,
      })
    } catch (error) {
      this.store.set({
        status: 'error',
        groups: this.store.getSnapshot().groups,
        failures: this.store.getSnapshot().failures,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
