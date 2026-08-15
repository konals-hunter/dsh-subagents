/**
 * reasoningEffort injection for profiled subagents. The host listens to the
 * agent/request waterfall and overrides reasoningEffort only for children whose
 * AgentOptions carry a subagentProfileId marker.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProfile } from './protocol.ts'
import type { SubagentProfileAgentOptions } from './tool.ts'
import type { SubagentStore } from './store.ts'

/**
 * Apply a profile's reasoningEffort onto a resolved LLM request.
 * @param resolved - the request config produced by the downstream waterfall.
 * @param agentOptions - the child agent's options (may carry the profile marker).
 * @param profile - matched profile, or undefined.
 * @returns the resolved config with reasoningEffort overridden when applicable.
 */
export function applyProfileEffort<T extends object>(
  resolved: T,
  agentOptions: Pick<SubagentProfileAgentOptions, 'subagentProfileId'>,
  profile: SubagentProfile | undefined,
): T & { reasoningEffort?: SubagentProfile['reasoningEffort'] } {
  if (agentOptions.subagentProfileId === undefined || profile?.reasoningEffort === undefined) return resolved
  return { ...resolved, reasoningEffort: profile.reasoningEffort }
}

/**
 * Register the agent/request waterfall listener.
 * @param ctx - host context.
 * @param store - profile store.
 * @returns the event disposer.
 */
export function installEffortInjection(ctx: Context, store: SubagentStore): () => void {
  return ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    const agentOptions = agent.options as SubagentProfileAgentOptions
    if (agentOptions.subagentProfileId === undefined) return resolved
    const profile = store.find(agentOptions.subagentProfileId)
    return applyProfileEffort(resolved, agentOptions, profile)
  })
}
