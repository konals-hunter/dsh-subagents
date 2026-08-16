import type { ModelThinkingConfig } from './protocol.ts'

export const DEFAULT_THINKING_CONFIGS: readonly ModelThinkingConfig[] = [
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
