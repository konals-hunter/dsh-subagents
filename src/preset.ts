/**
 * Preset composition for profiled subagents. The host listens to the
 * agent/created waterfall and recomposes the child agent context with the
 * selected preset when the AgentOptions carry a subagentPreset marker.
 *
 * Recompose is asynchronous: the core reads the composition file, ensures the
 * preset's standing mount, and re-links the child's scope parent. The child's
 * FIRST system-prompt assembly — which freezes the tool catalog for the first
 * model request — can therefore run before the rebind lands, leaving the first
 * request on the inherited parent preset (e.g. a bootstrap preset that hides
 * most tools). A system-prompt/assemble listener waits for the pending
 * recompose of a marked agent, then re-reads the tool catalog from the
 * re-bound scope chain and replaces the assembled tools, so the first request
 * runs under the SELECTED preset, not the inherited one.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
// Type-only: activate the dsh-agent AssembleContext.agent augmentation and the
// ctx.tools registry surface used to re-read the catalog after recompose.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { SubagentProfileAgentOptions } from './tool.ts'

/**
 * Lexicographic tool-name order, matching the harness default canonical order
 * (the system prompt sorts unlisted tools by code-unit name). A deployment
 * with a custom toolOrder would diverge here; the harness exposes no read
 * handle for it, so the default is the best this composition can reproduce.
 */
function orderToolsByName<T extends { name: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Register the agent/created listener that applies presets to profiled
 * subagents, plus the assemble listener that keeps the first request on the
 * selected preset even when recompose lands late.
 * @param ctx - host context.
 * @returns the event disposer.
 */
export function installPresetComposition(ctx: Context): () => void {
  /** agent id -> settled recompose promise (failure swallowed, never rejects). */
  const pendingRecomposes = new Map<string, Promise<void>>()

  const disposeCreated = ctx.on('agent/created', async ({ agent }) => {
    const agentOptions = agent.options as SubagentProfileAgentOptions | undefined
    const marker = agentOptions?.subagentPreset
    if (marker === undefined || marker === null || marker === 'inherit') return
    let preset = marker
    if (marker === 'default') {
      const agentPresets = ctx.get('agentPresets')
      if (agentPresets === undefined || typeof agentPresets.defaultId !== 'string') return
      preset = agentPresets.defaultId
    }
    if (preset === undefined || preset === null) return
    try {
      const agentPresets = ctx.get('agentPresets')
      if (agentPresets === undefined || typeof agentPresets.recompose !== 'function') return
      // Recompose stays fire-and-forget, but the promise is retained so the
      // first assembly can wait for the rebind before freezing its tools.
      const recomposing = Promise.resolve(agentPresets.recompose(agent.ctx, preset))
        .catch((error: unknown) => {
          console.warn('[dsh-subagents] preset recompose failed:', error)
        })
        .then(() => undefined)
      pendingRecomposes.set(agent.id, recomposing)
      void recomposing.finally(() => {
        pendingRecomposes.delete(agent.id)
      })
    } catch (error) {
      console.warn('[dsh-subagents] preset composition error:', error)
    }
  })

  // Global on purpose: marked children announce through their own scopes, and
  // a scope-filtered registration would not reliably see every child. The
  // pending map filters for us — unmarked agents pass straight through next().
  const disposeAssemble = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    const recomposing = agent !== undefined ? pendingRecomposes.get(agent.id) : undefined
    if (recomposing === undefined) return next()
    // Wait for the rebind so the scope chain below resolves the SELECTED
    // preset. A failure resolves the promise (swallowed above), so this never
    // hangs or rejects the assembly; it just keeps the inherited catalog.
    await recomposing
    const assembled = await next()
    const tools = ctx.tools.schemas(context.scope)
    if (tools.length === 0) return assembled
    return { ...assembled, tools: orderToolsByName(tools) } satisfies PromptAssembly
  }, { global: true })

  return () => {
    disposeCreated()
    disposeAssemble()
  }
}
