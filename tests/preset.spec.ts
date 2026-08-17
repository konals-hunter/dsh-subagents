import { describe, expect, it, vi } from 'vitest'
import { installPresetComposition } from '../src/preset.ts'

/** Minimal agent-shaped object; `id` is what the pending map keys on. */
interface FakeAgent {
  id: string
  options: { subagentPreset?: string | null }
  ctx: unknown
}

/** Capture listeners per event so tests can drive both agent/created and assemble. */
function captureContext(getAgentPresets: () => unknown) {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const schemas = vi.fn((): Array<{ name: string }> => [])
  const ctx = {
    on(event: string, listener: (...args: unknown[]) => unknown, options?: { global?: boolean }) {
      const list = listeners.get(event) ?? []
      const entry = (...args: unknown[]) => listener(...args)
      ;(entry as unknown as { global?: boolean }).global = options?.global ?? false
      list.push(entry)
      listeners.set(event, list)
      return () => {}
    },
    get: vi.fn(() => getAgentPresets()),
    tools: { schemas },
  } as never
  return { ctx, listeners, schemas }
}

function emitCreated(listeners: Map<string, Array<(...args: unknown[]) => unknown>>, agent: FakeAgent) {
  for (const listener of listeners.get('agent/created') ?? []) {
    void listener({ agent })
  }
}

async function emitAssemble(
  listeners: Map<string, Array<(...args: unknown[]) => unknown>>,
  agent: FakeAgent | undefined,
  assembly: { tools: Array<{ name: string }> },
): Promise<{ tools: Array<{ name: string }> }> {
  const next = vi.fn(async () => assembly)
  for (const listener of listeners.get('system-prompt/assemble') ?? []) {
    // Listener signature is (assembly, context, next).
    return await listener(assembly, { agent, scope: agent ?? {} }, next) as { tools: Array<{ name: string }> }
  }
  return assembly
}

describe('installPresetComposition', () => {
  it('calls agentPresets.recompose when subagentPreset is present', async () => {
    const recompose = vi.fn(async () => {})
    const { ctx, listeners } = captureContext(() => ({ recompose }))
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'standard' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).toHaveBeenCalledWith('child-ctx', 'standard')
  })

  it('skips recompose when subagentPreset is absent', async () => {
    const recompose = vi.fn(async () => {})
    const { ctx, listeners } = captureContext(() => ({ recompose }))
    const agent: FakeAgent = { id: 'child-1', options: {}, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })

  it('skips recompose when agentPresets service is missing', async () => {
    const { ctx, listeners } = captureContext(() => undefined)
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'standard' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('logs and swallows recompose errors', async () => {
    const warn = vi.mocked(console.warn)
    warn.mockClear()
    const recompose = vi.fn(async () => { throw new Error('recompose boom') })
    const { ctx, listeners } = captureContext(() => ({ recompose }))
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'standard' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recompose failed'), expect.any(Error))
  })

  it('resolves default preset via agentPresets.defaultId', async () => {
    const recompose = vi.fn(async () => {})
    const { ctx, listeners } = captureContext(() => ({ recompose, defaultId: 'user-default' }))
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'default' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).toHaveBeenCalledWith('child-ctx', 'user-default')
  })

  it('skips recompose when subagentPreset is inherit', async () => {
    const recompose = vi.fn(async () => {})
    const { ctx, listeners } = captureContext(() => ({ recompose, defaultId: 'user-default' }))
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'inherit' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })

  it('skips default resolution when agentPresets.defaultId is missing', async () => {
    const recompose = vi.fn(async () => {})
    const { ctx, listeners } = captureContext(() => ({ recompose }))
    const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'default' }, ctx: 'child-ctx' }

    installPresetComposition(ctx)
    emitCreated(listeners, agent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recompose).not.toHaveBeenCalled()
  })

  describe('first-assembly tool freeze (the recompose-race fix)', () => {
    it('waits for recompose, then replaces tools from the re-bound scope chain', async () => {
      let resolveRecompose: (() => void) | undefined
      const recompose = vi.fn(async () => new Promise<void>(resolve => { resolveRecompose = resolve }))
      const { ctx, listeners, schemas } = captureContext(() => ({ recompose }))
      const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'standard' }, ctx: 'child-ctx' }
      const freshTools = [
        { name: 'read' },
        { name: 'read_image' },
        { name: 'write' },
        { name: 'pwsh' },
      ]

      installPresetComposition(ctx)
      emitCreated(listeners, agent)

      // The first assembly starts while recompose is still pending.
      const emitted = emitAssemble(listeners, agent, { tools: [{ name: 'pwsh' }, { name: 'read' }] })
      const settled = await Promise.race([emitted.then(() => 'settled'), Promise.resolve('pending')])
      expect(settled).toBe('pending')

      // Rebound scope now exposes the selected preset's catalog.
      schemas.mockReturnValue(freshTools)
      resolveRecompose?.()
      const result = await emitted
      expect(recompose).toHaveBeenCalledWith('child-ctx', 'standard')
      expect(result.tools.map(tool => tool.name)).toEqual(['pwsh', 'read', 'read_image', 'write'])
    })

    it('passes unmarked agents straight through without waiting', async () => {
      const recompose = vi.fn(async () => {})
      const { ctx, listeners } = captureContext(() => ({ recompose }))
      const agent: FakeAgent = { id: 'plain-1', options: {}, ctx: 'child-ctx' }

      installPresetComposition(ctx)
      emitCreated(listeners, agent)

      const original = { tools: [{ name: 'pwsh' }, { name: 'read' }] }
      const result = await emitAssemble(listeners, agent, original)
      expect(recompose).not.toHaveBeenCalled()
      expect(result.tools).toEqual(original.tools)
    })

    it('keeps the inherited catalog when recompose fails (no hang, no throw)', async () => {
      const recompose = vi.fn(async () => { throw new Error('recompose boom') })
      const { ctx, listeners } = captureContext(() => ({ recompose }))
      const agent: FakeAgent = { id: 'child-1', options: { subagentPreset: 'standard' }, ctx: 'child-ctx' }

      installPresetComposition(ctx)
      emitCreated(listeners, agent)

      const original = { tools: [{ name: 'pwsh' }, { name: 'read' }] }
      const result = await emitAssemble(listeners, agent, original)
      expect(result.tools).toEqual(original.tools)
    })
  })
})
