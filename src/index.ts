import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-subagents'
export const inject = ['webServer', 'tools', 'subagents'] as const

export function apply(ctx: Context): void {
  void ctx
}
