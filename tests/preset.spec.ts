import { describe, expect, it, vi } from 'vitest'
import { installPresetComposition } from '../src/preset.ts'

describe('installPresetComposition', () => {
  it('calls agentPresets.recompose when subagentPreset is present', async () => {
    const recompose = vi.fn(async () => {})
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset?: string | null }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'standard' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose })),
    } as never

    const dispose = installPresetComposition(ctx)
    expect(typeof dispose).toBe('function')

    // recompose is fire-and-forget, so we wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).toHaveBeenCalledWith('child-ctx', 'standard')
  })

  it('skips recompose when subagentPreset is absent', async () => {
    const recompose = vi.fn(async () => {})
    const on = vi.fn((_event: string, listener: (event: { agent: { options: Record<string, unknown>; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: {},
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose })),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })

  it('skips recompose when agentPresets service is missing', async () => {
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset: string }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'standard' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => undefined),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('logs and swallows recompose errors', async () => {
    const warn = vi.mocked(console.warn)
    warn.mockClear()
    const recompose = vi.fn(async () => { throw new Error('recompose boom') })
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset: string }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'standard' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose })),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recompose failed'), expect.any(Error))
  })

  it('resolves default preset via agentPresets.defaultId', async () => {
    const recompose = vi.fn(async () => {})
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset: string }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'default' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose, defaultId: 'user-default' })),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).toHaveBeenCalledWith('child-ctx', 'user-default')
  })

  it('skips recompose when subagentPreset is inherit', async () => {
    const recompose = vi.fn(async () => {})
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset: string }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'inherit' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose, defaultId: 'user-default' })),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })

  it('skips default resolution when agentPresets.defaultId is missing', async () => {
    const recompose = vi.fn(async () => {})
    const on = vi.fn((_event: string, listener: (event: { agent: { options: { subagentPreset: string }; ctx: unknown } }) => void) => {
      listener({
        agent: {
          options: { subagentPreset: 'default' },
          ctx: 'child-ctx',
        },
      } as Parameters<typeof listener>[0])
      return () => {}
    })
    const ctx = {
      on,
      get: vi.fn(() => ({ recompose })),
    } as never

    installPresetComposition(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })
})
