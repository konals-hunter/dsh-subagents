/**
 * dsh-subagents — host half. Mounts the profile store, loopback REST routes,
 * the subagent_profile tool, and the agent/request reasoningEffort injection.
 * The browser half renders the Settings Subagents section.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import { SubagentStore } from './store.ts'
import { makeRoutes } from './routes.ts'
import { makeSubagentProfileTool } from './tool.ts'
import { installEffortInjection } from './effort.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-subagents'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'tools', 'subagents'] as const

/**
 * Mount the store, routes, tool, and effort listener. Tool registration is
 * rebuilt whenever the store notifies (REST create/update/delete/restore).
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  const store = new SubagentStore()
  store.restoreBuiltins()

  const { routes } = makeRoutes({ store })

  ctx.effect(() => {
    let disposeTool: (() => void) | undefined
    const syncTool = (): void => {
      if (disposeTool !== undefined) { disposeTool(); disposeTool = undefined }
      disposeTool = ctx.tools.register(makeSubagentProfileTool({ store, ctx }))
    }
    const disposers = routes.map(route => ctx.webServer.register(route))
    const disposeEffort = installEffortInjection(ctx, store)
    const unsubscribe = store.subscribe(syncTool)
    syncTool()
    return () => {
      for (const dispose of disposers) dispose()
      disposeEffort()
      unsubscribe()
      if (disposeTool !== undefined) disposeTool()
    }
  }, 'dsh-subagents: surfaces')
}

export { SubagentStore } from './store.ts'
export { makeRoutes } from './routes.ts'
export { makeSubagentProfileTool } from './tool.ts'
export { installEffortInjection } from './effort.ts'
