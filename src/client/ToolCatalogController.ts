/**
 * Host-scoped tool catalog controller for the Subagents settings section.
 * Loads the available tool names from the host and exposes them through a
 * SnapshotStore so ToolMultiSelect can render without extra prop drilling.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentsApi } from './api.ts'

export interface ToolCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  tools: string[]
  error?: string
}

/** Small controller owning the tool catalog snapshot shared by every ToolMultiSelect. */
export class ToolCatalogController {
  readonly store: SnapshotStore<ToolCatalogState> = createSnapshotStore<ToolCatalogState>({
    status: 'idle',
    tools: [],
  })

  constructor(private readonly api: Pick<SubagentsApi, 'listTools'>) {}

  /**
   * Refresh the host tool catalog.
   * @returns a promise that settles after the store is updated.
   */
  async load(): Promise<void> {
    this.store.update(draft => {
      draft.status = 'loading'
      draft.error = undefined
    })
    try {
      const result = await this.api.listTools()
      this.store.set({ status: 'ready', tools: result.tools })
    } catch (error) {
      this.store.set({
        status: 'error',
        tools: this.store.getSnapshot().tools,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
