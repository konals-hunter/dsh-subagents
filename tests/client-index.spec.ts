/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('client apply registration', () => {
  it('registers locale dictionaries and injects the settings section', () => {
    const localeRegister = vi.fn()
    const slotsInject = vi.fn()
    const slotsRegister = vi.fn(() => 'registered')
    const effect = vi.fn((callback: () => void) => callback())
    const get = vi.fn(() => ({
      api: {
        llm: {
          models: vi.fn(async () => ({ result: { ok: true, value: { groups: [], failures: [] } } })),
        },
      },
    }))
    const ctx = {
      effect,
      locale: { register: localeRegister },
      slots: {
        inject: slotsInject,
        register: slotsRegister,
      },
      get,
    }

    apply(ctx as never)

    expect(effect).toHaveBeenCalled()
    expect(localeRegister).toHaveBeenCalledWith(
      'dsh-subagents',
      expect.objectContaining({ en: expect.any(Object), zh: expect.any(Object) }),
    )
    expect(slotsInject).toHaveBeenCalledWith('settings.section', expect.any(Function))

    const registerFactory = slotsInject.mock.calls[0]?.[1] as () => unknown
    expect(registerFactory()).toBe('registered')
    expect(slotsRegister).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.section', id: 'subagents' }),
      expect.anything(),
    )

    const registerCalls = slotsRegister.mock.calls as unknown as Array<[{ inject(): Record<string, unknown> }]>
    const descriptor = registerCalls[0]?.[0]
    expect(descriptor).toHaveProperty('inject')
    const injected = descriptor!.inject()
    expect(injected.hooks).toHaveProperty('toolCatalog')
    expect(injected.loadTools).toBeInstanceOf(Function)
  })
})
