import { describe, expect, it, vi } from 'vitest'
import { SubagentStore, makeRoutes, makeSubagentProfileTool, installEffortInjection, apply } from '../src/index.ts'

vi.mock('../src/store.ts', () => {
  class SubagentStore {
    restoreBuiltins() {
      return []
    }

    subscribe() {
      return () => {}
    }

    enabledIds() {
      return ['explore']
    }

    list() {
      return []
    }

    find() {
      return undefined
    }
  }

  return {
    SubagentStore,
    validateProfilePayload: () => ({}),
    validateProfilePatch: () => ({}),
  }
})

describe('host wiring', () => {
  it('exposes the expected constructors', () => {
    expect(typeof SubagentStore).toBe('function')
    expect(typeof makeRoutes).toBe('function')
    expect(typeof makeSubagentProfileTool).toBe('function')
    expect(typeof installEffortInjection).toBe('function')
  })

  it('applies with a minimal Cordis-like context', () => {
    const registerTool = vi.fn(() => () => {})
    const registerRoute = vi.fn(() => () => {})
    const on = vi.fn(() => () => {})
    const effect = vi.fn((callback: () => () => void) => callback())
    const ctx = {
      effect,
      tools: { register: registerTool },
      webServer: { register: registerRoute },
      on,
    } as never

    apply(ctx as never)

    expect(effect).toHaveBeenCalled()
    expect(registerRoute).toHaveBeenCalledTimes(2)
    expect(registerTool).toHaveBeenCalled()
    expect(on).toHaveBeenCalledWith('agent/request', expect.any(Function))
  })
})
