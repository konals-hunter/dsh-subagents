/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { ModelCatalogController } from '../src/client/ModelCatalogController.ts'

describe('ModelCatalogController', () => {
  it('loads provider groups into the store', async () => {
    const models = vi.fn(async () => ({
      result: {
        ok: true,
        value: {
          groups: [{ id: 'jiyuan', name: 'Jiyuan', models: [{ id: 'm1', name: 'M1' }] }],
          failures: [],
        },
      },
    }))
    const controller = new ModelCatalogController({ llm: { models } } as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().groups[0]?.id).toBe('jiyuan')
    expect(controller.store.getSnapshot().failures).toEqual([])
  })

  it('reports a failed catalog request without losing last good groups', async () => {
    const models = vi.fn()
      .mockResolvedValueOnce({
        result: {
          ok: true,
          value: {
            groups: [{ id: 'jiyuan', name: 'Jiyuan', models: [{ id: 'm1', name: 'M1' }] }],
            failures: [],
          },
        },
      })
      .mockResolvedValueOnce({
        result: { ok: false, error: { code: 'ERR', message: 'catalog down' } },
      })
    const controller = new ModelCatalogController({ llm: { models } } as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toContain('catalog down')
    expect(controller.store.getSnapshot().groups[0]?.id).toBe('jiyuan')
  })
})
