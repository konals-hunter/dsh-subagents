import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['slots', 'locale'] as const

export function apply(ctx: ClientContext): void {
  void ctx
}
