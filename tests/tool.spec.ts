import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { joinPrompt, makeSubagentProfileTool, resolveProfileRequest } from '../src/tool.ts'
import type { SubagentStore } from '../src/store.ts'
import type { SubagentProfile } from '../src/protocol.ts'

const profile: SubagentProfile = {
  id: 'explore',
  name: 'Explore',
  description: 'explore',
  enabled: true,
  builtin: true,
  provider: 'spawn',
  modelProvider: 'jiyuan',
  model: 'deepseek-v4-flash-0731',
  reasoningEffort: 'high',
  maxTokens: 2048,
  maxDepth: 2,
  persona: 'You are explore.',
  promptTemplate: 'Explore first.',
  toolFilter: { deny: ['edit'] },
  backgroundMode: 'one-shot',
  createdAt: 1,
  updatedAt: 1,
}

function fakeStore(profiles: SubagentProfile[]): SubagentStore & { recordContinuableProfile: ReturnType<typeof vi.fn> } {
  return {
    enabledIds: () => profiles.filter(item => item.enabled).map(item => item.id),
    find: (id: string) => profiles.find(item => item.id === id),
    recordContinuableProfile: vi.fn(),
  } as unknown as SubagentStore & { recordContinuableProfile: ReturnType<typeof vi.fn> }
}

function fakeCtx(overrides: {
  start?: ReturnType<typeof vi.fn>
  startContinuable?: ReturnType<typeof vi.fn>
  get?: ReturnType<typeof vi.fn>
} = {}): Context {
  const ctx = {
    subagents: {
      start: overrides.start ?? vi.fn(),
      startContinuable: overrides.startContinuable ?? vi.fn(),
    },
    get: overrides.get ?? vi.fn(),
    on: vi.fn(() => () => {}),
  }
  return ctx as unknown as Context
}

function fakeExec(): ToolRunContext {
  const parent = { id: 'parent', session: { id: 'parent' } } as unknown as Agent
  return {
    agent: parent,
    signal: new AbortController().signal,
    deferContext: vi.fn(),
    concludeTurn: vi.fn(),
  } as unknown as ToolRunContext
}

function completedRun(output: SubagentResult['output'] = [{ type: 'text', text: 'done' }]): { run: SubagentRun; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn(async () => {})
  const run = {
    id: 'run-1',
    result: Promise.resolve({ stopReason: 'completed', output } as SubagentResult),
    dispose,
  } as unknown as SubagentRun
  return { run, dispose }
}

describe('subagent profile tool helpers', () => {
  it('joins promptTemplate before the user prompt', () => {
    expect(joinPrompt('Explore first.', 'Find the bug.')).toBe('Explore first.\n\nFind the bug.')
    expect(joinPrompt('', 'Task')).toBe('Task')
    expect(joinPrompt(undefined, 'Task')).toBe('Task')
  })

  it('resolves a profile into child request fields', () => {
    const resolved = resolveProfileRequest({ profile: 'explore', prompt: 'Find it' }, profile)
    expect(resolved.prompt).toBe('Explore first.\n\nFind it')
    expect(resolved.agentOptions).toMatchObject({
      provider: 'jiyuan',
      model: 'deepseek-v4-flash-0731',
      maxTokens: 2048,
      subagentProfileId: 'explore',
    })
    expect(resolved.persona).toBe('You are explore.')
    expect(resolved.toolFilter).toEqual({ deny: ['edit'] })
    expect(resolved.maxDepth).toBe(2)
  })

  it('resolves no profile to a plain free prompt', () => {
    const resolved = resolveProfileRequest({ prompt: 'Just do it' }, undefined)
    expect(resolved.prompt).toBe('Just do it')
    expect(resolved.agentOptions.subagentProfileId).toBeUndefined()
    expect(resolved.persona).toBeUndefined()
  })
})

describe('subagent profile tool schema', () => {
  it('registers without a profile parameter when no profiles are enabled', () => {
    const tool = makeSubagentProfileTool({ store: fakeStore([]), ctx: fakeCtx() })
    const parameters = tool.parameters as { properties?: Record<string, unknown>; profile?: unknown }
    expect(parameters.profile).toBeUndefined()
    expect(parameters.properties?.profile).toBeUndefined()
  })
})

describe('subagent profile tool execute', () => {
  it('delegates freely in the foreground and disposes the run', async () => {
    const { run, dispose } = completedRun()
    const start = vi.fn(async () => run)
    const ctx = fakeCtx({ start })
    const tool = makeSubagentProfileTool({ store: fakeStore([profile]), ctx })

    const result = await tool.execute({ prompt: 'Do it' }, fakeExec())

    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'Do it',
      parent: expect.anything(),
      signal: expect.any(AbortSignal),
    }))
    expect(dispose).toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'foreground', runId: 'run-1', output: [{ type: 'text', text: 'done' }] })
  })

  it('rejects disabled profiles before starting a child', async () => {
    const disabled = { ...profile, id: 'disabled', enabled: false }
    const store = {
      enabledIds: () => ['disabled'],
      find: () => disabled,
    } as unknown as SubagentStore
    const ctx = fakeCtx()
    const tool = makeSubagentProfileTool({ store, ctx })

    await expect(tool.execute({ profile: 'disabled', prompt: 'x' }, fakeExec())).rejects.toThrow(/disabled/)
    expect(ctx.subagents.start).not.toHaveBeenCalled()
  })

  it('runs a selected enabled profile in the foreground', async () => {
    const { run, dispose } = completedRun()
    const start = vi.fn(async () => run)
    const ctx = fakeCtx({ start })
    const tool = makeSubagentProfileTool({ store: fakeStore([profile]), ctx })

    const result = await tool.execute({ profile: 'explore', prompt: 'Find it' }, fakeExec())

    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'Explore',
      agentOptions: expect.objectContaining({ provider: 'jiyuan', model: 'deepseek-v4-flash-0731', subagentProfileId: 'explore' }),
      prompt: expect.any(Array),
    }))
    expect(dispose).toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'foreground', runId: 'run-1' })
  })

  it('starts a background job for one-shot profiles', async () => {
    const start = vi.fn()
    const jobStart = vi.fn(() => 'job-1')
    const ctx = fakeCtx({
      get: vi.fn((key: string) => key === 'jobs' ? { start: jobStart } : undefined),
    })
    const tool = makeSubagentProfileTool({ store: fakeStore([profile]), ctx })

    const result = await tool.execute({ prompt: 'Bg', run_in_background: true }, fakeExec())

    expect(ctx.get).toHaveBeenCalledWith('jobs')
    expect(jobStart).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'subagent',
      label: 'Bg',
      owner: expect.anything(),
    }))
    expect(start).not.toHaveBeenCalled()
    expect(result).toEqual({ kind: 'background', jobId: 'job-1' })
  })

  it('starts a continuable subagent for continuable profiles', async () => {
    const continuable = { ...profile, id: 'cont', backgroundMode: 'continuable' as const }
    const startContinuable = vi.fn(async () => ({ childId: 'child-1' }))
    const ctx = fakeCtx({ startContinuable })
    const tool = makeSubagentProfileTool({ store: fakeStore([continuable]), ctx })

    const result = await tool.execute({ profile: 'cont', prompt: 'Keep going' }, fakeExec())

    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'spawn',
      label: 'Explore',
      request: expect.objectContaining({ prompt: expect.any(Array), parent: expect.anything() }),
    }))
    expect(result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
  })

  it('records the continuable child profile id for cold-resume effort injection', async () => {
    const continuable = { ...profile, id: 'cont', backgroundMode: 'continuable' as const }
    const startContinuable = vi.fn(async () => ({ childId: 'child-1' }))
    const store = fakeStore([continuable])
    const ctx = fakeCtx({ startContinuable })
    const tool = makeSubagentProfileTool({ store, ctx })

    const result = await tool.execute({ profile: 'cont', prompt: 'Keep going' }, fakeExec())

    expect(store.recordContinuableProfile).toHaveBeenCalledWith('child-1', 'cont')
    expect(result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
  })

  it('still starts a continuable child when run_in_background is false', async () => {
    const continuable = { ...profile, id: 'cont', backgroundMode: 'continuable' as const }
    const startContinuable = vi.fn(async () => ({ childId: 'child-1' }))
    const ctx = fakeCtx({ startContinuable })
    const tool = makeSubagentProfileTool({ store: fakeStore([continuable]), ctx })

    const result = await tool.execute({ profile: 'cont', prompt: 'Keep going', run_in_background: false }, fakeExec())

    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'spawn',
      label: 'Explore',
      request: expect.objectContaining({ prompt: expect.any(Array), parent: expect.anything() }),
    }))
    expect(result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
  })

  it('disposes the foreground run when result rejects', async () => {
    const dispose = vi.fn(async () => {})
    let rejectResult: (error: Error) => void = () => {}
    const result = new Promise<SubagentResult>((_resolve, reject) => { rejectResult = reject })
    const run = {
      id: 'run-err',
      result,
      dispose,
    } as unknown as SubagentRun
    const start = vi.fn(async () => run)
    const ctx = fakeCtx({ start })
    const tool = makeSubagentProfileTool({ store: fakeStore([profile]), ctx })

    const execution = tool.execute({ prompt: 'x' }, fakeExec())
    rejectResult(new Error('infra failure'))
    await expect(execution).rejects.toThrow('infra failure')
    expect(dispose).toHaveBeenCalled()
  })
})
