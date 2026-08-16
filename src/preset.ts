/**
 * Preset composition for profiled subagents. The host listens to the
 * agent/created waterfall and recomposes the child agent context with the
 * selected preset when the AgentOptions carry a subagentPreset marker.
 *
 * This is best-effort: the listener runs after the agent is created, so the
 * preset is applied asynchronously. A future DSH core API could make this
 * deterministic by composing the preset before the agent is fully initialized.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProfileAgentOptions } from './tool.ts'

/**
 * Register the agent/created listener that applies presets to profiled
 * subagents.
 * @param ctx - host context.
 * @returns the event disposer.
 */
export function installPresetComposition(ctx: Context): () => void {
  return ctx.on('agent/created', async ({ agent }) => {
    const agentOptions = agent.options as SubagentProfileAgentOptions | undefined
    const preset = agentOptions?.subagentPreset
    if (preset === undefined || preset === null) return
    try {
      const agentPresets = ctx.get('agentPresets')
      if (agentPresets === undefined || typeof agentPresets.recompose !== 'function') return
      // Best-effort fire-and-forget: recompose is asynchronous and we do not
      // want to block agent creation on it.
      void agentPresets.recompose(agent.ctx, preset).catch((error: unknown) => {
        console.warn('[dsh-subagents] preset recompose failed:', error)
      })
    } catch (error) {
      console.warn('[dsh-subagents] preset composition error:', error)
    }
  })
}
