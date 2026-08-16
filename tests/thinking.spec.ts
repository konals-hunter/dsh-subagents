import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelThinkingConfig } from '../src/protocol.ts'
import { findCatalogReasoning, findManualThinkingConfig, getEffectiveDefaultEffort, getEffectiveReasoning } from '../src/thinking.ts'

const manual: ModelThinkingConfig[] = [
  {
    provider: 'stepfun',
    model: 'step-3.7-flash',
    variants: [
      { id: 'low', name: 'low' },
      { id: 'medium', name: 'medium' },
      { id: 'high', name: 'high' },
    ],
    defaultVariant: 'medium',
  },
]

const groups: ModelProviderGroup[] = [
  {
    id: 'jiyuan',
    name: 'Jiyuan',
    models: [
      {
        id: 'deepseek-v4-flash-0731',
        name: 'DeepSeek V4 Flash 0731',
        reasoning: {
          efforts: [{ id: 'off', name: 'off' }, { id: 'max', name: 'max' }],
          defaultEffort: 'max',
        },
      },
    ],
  },
]

describe('thinking config merge', () => {
  it('finds a manual config by provider and model', () => {
    expect(findManualThinkingConfig('stepfun', 'step-3.7-flash', manual)?.defaultVariant).toBe('medium')
    expect(findManualThinkingConfig('jiyuan', 'nope', manual)).toBeUndefined()
  })

  it('reads catalog reasoning when no manual config exists', () => {
    expect(findCatalogReasoning('jiyuan', 'deepseek-v4-flash-0731', groups)?.defaultEffort).toBe('max')
    expect(findCatalogReasoning('stepfun', 'step-3.7-flash', groups)).toBeUndefined()
  })

  it('prefers manual config over catalog reasoning', () => {
    const mixed = [
      ...manual,
      {
        provider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        variants: [{ id: 'low', name: 'low' }],
        defaultVariant: 'low',
      },
    ]
    expect(getEffectiveReasoning('jiyuan', 'deepseek-v4-flash-0731', mixed, groups)?.defaultEffort).toBe('low')
  })

  it('returns undefined when neither source has reasoning', () => {
    expect(getEffectiveReasoning('unknown', 'model', [], groups)).toBeUndefined()
  })

  it('resolves the effective default effort', () => {
    expect(getEffectiveDefaultEffort(getEffectiveReasoning('stepfun', 'step-3.7-flash', manual, []))).toBe('medium')
    expect(getEffectiveDefaultEffort(undefined)).toBeUndefined()
  })
})
