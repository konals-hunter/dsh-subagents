import { describe, expect, it, vi } from 'vitest'
import { SubagentStore, makeRoutes, makeSubagentProfileTool, installEffortInjection, installPresetComposition, apply } from '../src/index.ts'

vi.mock('../src/store.ts', () => {
  const listeners = new Set<() => void>()
  class SubagentStore {
    restoreBuiltins() {
      return []
    }

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    enabledIds() {
      // Simulate a store notification that can happen while syncTool is
      // building the tool (e.g. first-read builtin merge/normalization).
      for (const listener of [...listeners]) listener()
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
    expect(typeof installPresetComposition).toBe('function')
  })

  it('applies with a minimal Cordis-like context', () => {
    const registerTool = vi.fn(() => () => {})
    const registerRoute = vi.fn(() => () => {})
    const on = vi.fn(() => () => {})
    const section = vi.fn(() => () => {})
    const effect = vi.fn((callback: () => void) => callback())
    const ctx = {
      effect,
      tools: { register: registerTool },
      webServer: { register: registerRoute },
      systemPrompt: { section },
      on,
      get: vi.fn(() => undefined),
    } as never

    apply(ctx as never)

    expect(effect).toHaveBeenCalled()
    expect(registerRoute).toHaveBeenCalledTimes(4)
    expect(registerTool).toHaveBeenCalled()
    expect(on).toHaveBeenCalledWith('agent/request', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agent/created', expect.any(Function))
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ name: 'dsh-subagents:image-reading' }))
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ name: 'dsh-subagents:profiles' }))
  })

  it('does not re-enter syncTool when tool creation notifies the store', () => {
    const registerTool = vi.fn(() => () => {})
    const registerRoute = vi.fn(() => () => {})
    const on = vi.fn(() => () => {})
    const section = vi.fn(() => () => {})
    const effect = vi.fn((callback: () => () => void) => callback())
    const ctx = {
      effect,
      tools: { register: registerTool },
      webServer: { register: registerRoute },
      systemPrompt: { section },
      on,
      get: vi.fn(() => undefined),
    } as never

    apply(ctx as never)

    expect(registerTool).toHaveBeenCalledTimes(1)
  })
})
