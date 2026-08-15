import { describe, expect, it } from 'vitest'
import { joinPrompt, resolveProfileRequest } from '../src/tool.ts'
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
