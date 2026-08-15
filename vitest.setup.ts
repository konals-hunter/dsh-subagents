/**
 * The rc.6 client runtime bundle registers itself through the GUI module
 * loader (`window.__ModuleLoader__.load`), so importing its value under
 * vitest yields no usable ESM exports. Provide a minimal snapshot store with
 * the same contract (getSnapshot / subscribe / set / draft-style update) for
 * controller tests.
 */
import { vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T>(initial: T) => {
    let snapshot = { ...initial }
    const listeners = new Set<() => void>()
    const publish = (): void => {
      for (const listener of listeners) listener()
    }
    return {
      getSnapshot: (): T => snapshot,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: T): void => {
        snapshot = { ...next }
        publish()
      },
      update: (mutator: (draft: T) => void): void => {
        const draft = { ...snapshot }
        mutator(draft)
        snapshot = { ...draft }
        publish()
      },
    }
  },
}))
