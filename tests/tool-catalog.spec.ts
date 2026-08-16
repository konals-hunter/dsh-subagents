import { describe, expect, it, vi } from 'vitest'
import { ToolCatalogController } from '../src/client/ToolCatalogController.ts'

describe('ToolCatalogController', () => {
  it('starts idle and updates to loading then ready with tool names', async () => {
    const api = { listTools: vi.fn(async () => ({ tools: ['read_file', 'write_file'] })) }
    const controller = new ToolCatalogController(api)
    expect(controller.store.getSnapshot()).toEqual({ status: 'idle', tools: [] })

    await controller.load()
    expect(api.listTools).toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', tools: ['read_file', 'write_file'] })
  })

  it('surfaces listTools errors in the store', async () => {
    const api = { listTools: vi.fn(async () => { throw new Error('network boom') }) }
    const controller = new ToolCatalogController(api)

    await controller.load()
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.tools).toEqual([])
    expect(snapshot.error).toBe('network boom')
  })
})
