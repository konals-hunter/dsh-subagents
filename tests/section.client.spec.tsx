/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useSyncExternalStore } from 'react'
import { SubagentsSection } from '../src/client/SubagentsSection.tsx'
import type { SubagentsSectionInjected } from '../src/client/SubagentsSection.tsx'
import { SubagentsSectionController } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentProfile } from '../src/protocol.ts'
import type { SubagentsSectionState } from '../src/client/controller.ts'
import type { ModelCatalogState } from '../src/client/ModelCatalogController.ts'
import type { ToolCatalogState } from '../src/client/ToolCatalogController.ts'

const builtinProfile: SubagentProfile = {
  id: 'explore',
  name: 'Explore',
  description: 'explore',
  enabled: true,
  builtin: true,
  provider: 'spawn',
  modelProvider: 'jiyuan',
  model: 'deepseek-v4-flash-0731',
  reasoningEffort: 'high',
  createdAt: 1,
  updatedAt: 1,
}

const customProfile: SubagentProfile = {
  id: 'custom-1',
  name: 'Custom',
  description: 'custom',
  enabled: true,
  builtin: false,
  provider: 'spawn',
  modelProvider: 'jiyuan',
  model: 'deepseek-v4-flash-0731',
  createdAt: 2,
  updatedAt: 2,
}

const catalogState: ModelCatalogState = {
  status: 'ready',
  groups: [{
    id: 'jiyuan',
    name: 'Jiyuan',
    models: [
      { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' },
      { id: 'deepseek-v4-0731', name: 'DeepSeek V4 0731' },
    ],
  }],
  failures: [],
}

function renderSection(
  overrides: Partial<SubagentsSectionInjected> = {},
  profiles: SubagentProfile[] = [builtinProfile],
  corrupt = false,
) {
  const store = createSnapshotStore({ status: 'ready' as const, profiles, corrupt })
  const catalogStore = createSnapshotStore<ModelCatalogState>(catalogState)
  const toolCatalogStore = createSnapshotStore<ToolCatalogState>({ status: 'ready', tools: ['read_file', 'write_file'] })
  const useSubagents = <T,>(selector: (snapshot: SubagentsSectionState) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  const useModelCatalog = <T,>(selector: (snapshot: ModelCatalogState) => T): T =>
    useSyncExternalStore(catalogStore.subscribe, () => selector(catalogStore.getSnapshot()))
  const useToolCatalog = <T,>(selector: (snapshot: ToolCatalogState) => T): T =>
    useSyncExternalStore(toolCatalogStore.subscribe, () => selector(toolCatalogStore.getSnapshot()))
  const base: SubagentsSectionInjected = {
    hooks: { subagents: store, modelCatalog: catalogStore, toolCatalog: toolCatalogStore },
    load: vi.fn(async () => {}),
    loadModels: vi.fn(async () => {}),
    loadTools: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    restoreBuiltins: vi.fn(async () => {}),
  }
  return { store, catalogStore, toolCatalogStore, useSubagents, useModelCatalog, useToolCatalog, ...base, ...overrides }
}

function mountSection(injected: ReturnType<typeof renderSection>): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<SubagentsSection
      useSubagents={injected.useSubagents}
      useModelCatalog={injected.useModelCatalog}
      useToolCatalog={injected.useToolCatalog}
      useSessions={selector => selector({} as never)}
      useWorkspaces={selector => selector({} as never)}
      t={key => (zh as Record<string, string>)[key]}
      close={vi.fn()}
      load={injected.load}
      loadModels={injected.loadModels}
      loadTools={injected.loadTools}
      create={injected.create}
      update={injected.update}
      remove={injected.remove}
      restoreBuiltins={injected.restoreBuiltins}
    />)
  })
  return { container, root }
}

function unmountSection(container: HTMLDivElement, root: ReturnType<typeof createRoot>): void {
  act(() => { root.unmount() })
  container.remove()
}

function changeField(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function fieldByLabel(container: HTMLDivElement, label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  const field = [...container.querySelectorAll('label')]
    .find(labelElement => labelElement.textContent?.includes(label))
    ?.querySelector('input, select, textarea')
  return field as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
}

describe('SubagentsSection', () => {
  it('renders builtin profiles without a delete action', () => {
    const injected = renderSection()
    const { container, root } = mountSection(injected)

    expect(container.textContent).toContain('Explore')
    expect(container.textContent).not.toContain('删除')
    unmountSection(container, root)
  })

  it('prefills the new profile form with the next free custom id', async () => {
    const injected = renderSection({}, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const addButton = [...container.querySelectorAll('button')].find(button => button.textContent === '新增 Subagent')
      expect(addButton).toBeDefined()
      await act(async () => { addButton?.click() })

      const idField = fieldByLabel(container, 'ID')
      expect(idField).not.toBeNull()
      expect((idField as HTMLInputElement).value).toBe('custom-2')
    } finally {
      unmountSection(container, root)
    }
  })

  it('shows a corruption banner when the store is corrupt', () => {
    const injected = renderSection({}, [builtinProfile], true)
    const { container, root } = mountSection(injected)

    expect(container.textContent).toContain('配置文件已损坏')
    unmountSection(container, root)
  })

  it('clears the corruption banner after a successful create', async () => {
    const api = {
      listProfiles: async () => ({ profiles: [builtinProfile], corrupt: true }),
      createProfile: vi.fn(async () => ({ ...customProfile, id: 'created' })),
      restoreBuiltins: async () => ({
        profiles: [builtinProfile],
        corrupt: true,
        error: 'store file is corrupt; manual recovery required',
      }),
    } as never
    const controller = new SubagentsSectionController(api as never)
    await controller.load()
    const store = controller.store
    const catalogStore = createSnapshotStore<ModelCatalogState>(catalogState)
    const toolCatalogStore = createSnapshotStore<ToolCatalogState>({ status: 'ready', tools: ['read_file', 'write_file'] })
    const useSubagents = <T,>(selector: (snapshot: SubagentsSectionState) => T): T =>
      useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
    const useModelCatalog = <T,>(selector: (snapshot: ModelCatalogState) => T): T =>
      useSyncExternalStore(catalogStore.subscribe, () => selector(catalogStore.getSnapshot()))
    const useToolCatalog = <T,>(selector: (snapshot: ToolCatalogState) => T): T =>
      useSyncExternalStore(toolCatalogStore.subscribe, () => selector(toolCatalogStore.getSnapshot()))
    const injected: SubagentsSectionInjected = {
      hooks: { subagents: store, modelCatalog: catalogStore, toolCatalog: toolCatalogStore },
      load: async () => {},
      loadModels: async () => {},
      loadTools: async () => {},
      create: payload => controller.create(payload),
      update: (id, patch) => controller.update(id, patch),
      remove: id => controller.remove(id),
      restoreBuiltins: () => controller.restoreBuiltins(),
    }
    const { container, root } = mountSection({ ...injected, store, useSubagents, useModelCatalog, useToolCatalog } as never)
    try {
      expect(container.textContent).toContain('配置文件已损坏')
      const addButton = [...container.querySelectorAll('button')].find(button => button.textContent === '新增 Subagent')
      expect(addButton).toBeDefined()
      await act(async () => { addButton?.click() })

      const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent === '保存')
      expect(saveButton).toBeDefined()
      await act(async () => { saveButton?.click() })

      expect(container.textContent).not.toContain('配置文件已损坏')
      expect(container.textContent).toContain('created')
    } finally {
      unmountSection(container, root)
    }
  })

  it('surfaces remove errors', async () => {
    const injected = renderSection({ remove: vi.fn(async () => { throw new Error('delete boom') }) }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const deleteButton = [...container.querySelectorAll('button')].find(button => button.textContent === '删除')
      expect(deleteButton).toBeDefined()
      await act(async () => { deleteButton?.click() })
      expect(container.textContent).toContain('delete boom')
    } finally {
      unmountSection(container, root)
    }
  })

  it('surfaces restore errors', async () => {
    const injected = renderSection({ restoreBuiltins: vi.fn(async () => { throw new Error('restore boom') }) })
    const { container, root } = mountSection(injected)
    try {
      const restoreButton = [...container.querySelectorAll('button')].find(button => button.textContent === '恢复内置')
      expect(restoreButton).toBeDefined()
      await act(async () => { restoreButton?.click() })
      expect(container.textContent).toContain('restore boom')
    } finally {
      unmountSection(container, root)
    }
  })

  it('sends null toolFilter when saving a profile with no allow/deny entries', async () => {
    const update = vi.fn(async () => {})
    const injected = renderSection({ update }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const editButton = [...container.querySelectorAll('button')].find(button => button.textContent === '编辑')
      expect(editButton).toBeDefined()
      await act(async () => { editButton?.click() })

      const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent === '保存')
      expect(saveButton).toBeDefined()
      await act(async () => { saveButton?.click() })

      expect(update).toHaveBeenCalledWith('custom-1', expect.objectContaining({ toolFilter: null }))
    } finally {
      unmountSection(container, root)
    }
  })

  it('sends null reasoningEffort, maxTokens and maxDepth when clearing the edit form', async () => {
    const update = vi.fn(async () => {})
    const clearingProfile: SubagentProfile = {
      ...customProfile,
      id: 'clearing',
      reasoningEffort: 'high',
      maxTokens: 123,
      maxDepth: 4,
    }
    const injected = renderSection({ update }, [clearingProfile])
    const { container, root } = mountSection(injected)
    try {
      const editButton = [...container.querySelectorAll('button')].find(button => button.textContent === '编辑')
      expect(editButton).toBeDefined()
      await act(async () => { editButton?.click() })

      const effortTrigger = [...container.querySelectorAll('button')].find(button => button.textContent === 'high' && !button.hasAttribute('aria-label'))
      const maxTokens = fieldByLabel(container, '最大输出 Tokens') as HTMLInputElement
      const maxDepth = fieldByLabel(container, '最大委派深度') as HTMLInputElement
      expect(effortTrigger).toBeDefined()
      expect(maxTokens).not.toBeNull()
      expect(maxDepth).not.toBeNull()

      await act(async () => { effortTrigger?.click() })
      const defaultEffort = [...container.querySelectorAll('button')].find(button => button.textContent === '默认')
      expect(defaultEffort).toBeDefined()
      await act(async () => {
        defaultEffort?.click()
        changeField(maxTokens, '')
        changeField(maxDepth, '')
      })

      const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent === '保存')
      expect(saveButton).toBeDefined()
      await act(async () => { saveButton?.click() })

      expect(update).toHaveBeenCalledWith('clearing', expect.objectContaining({
        reasoningEffort: null,
        maxTokens: null,
        maxDepth: null,
      }))
    } finally {
      unmountSection(container, root)
    }
  })

  it('toggles a profile enabled state from the list quick action', async () => {
    const update = vi.fn(async () => {})
    const injected = renderSection({ update }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const switchButton = container.querySelector('button[role="switch"]') as HTMLButtonElement | null
      expect(switchButton).not.toBeNull()
      await act(async () => { switchButton?.click() })
      expect(update).toHaveBeenCalledWith('custom-1', { enabled: false })
    } finally {
      unmountSection(container, root)
    }
  })

  it('switches a profile model from the list quick action', async () => {
    const update = vi.fn(async () => {})
    const injected = renderSection({ update }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const modelTrigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('jiyuan / deepseek-v4-flash-0731'))
      expect(modelTrigger).toBeDefined()
      await act(async () => { modelTrigger?.click() })

      const modelRow = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('DeepSeek V4 0731'))
      expect(modelRow).toBeDefined()
      await act(async () => { modelRow?.click() })

      expect(update).toHaveBeenCalledWith('custom-1', { modelProvider: 'jiyuan', model: 'deepseek-v4-0731' })
    } finally {
      unmountSection(container, root)
    }
  })

  it('changes the thinking variant from the list quick action', async () => {
    const update = vi.fn(async () => {})
    const injected = renderSection({ update }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const effortTrigger = [...container.querySelectorAll('button')].find(button => button.textContent === '默认')
      expect(effortTrigger).toBeDefined()
      await act(async () => { effortTrigger?.click() })

      const highRow = [...container.querySelectorAll('button')].find(button => button.textContent === 'high')
      expect(highRow).toBeDefined()
      await act(async () => { highRow?.click() })

      expect(update).toHaveBeenCalledWith('custom-1', { reasoningEffort: 'high' })
    } finally {
      unmountSection(container, root)
    }
  })

  it('toggles tool filter allow via the multi-select and sends null when cleared', async () => {
    const update = vi.fn(async () => {})
    const injected = renderSection({ update }, [customProfile])
    const { container, root } = mountSection(injected)
    try {
      const editButton = [...container.querySelectorAll('button')].find(button => button.textContent === '编辑')
      expect(editButton).toBeDefined()
      await act(async () => { editButton?.click() })

      const allowTrigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Select tools') && (button as HTMLButtonElement).getAttribute('aria-label')?.includes('工具过滤 Allow'))
      expect(allowTrigger).toBeDefined()
      await act(async () => { allowTrigger?.click() })

      const readFileRow = [...container.querySelectorAll('button')].find(button => button.textContent === 'read_file')
      expect(readFileRow).toBeDefined()
      await act(async () => { readFileRow?.click() })

      const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent === '保存')
      expect(saveButton).toBeDefined()
      await act(async () => { saveButton?.click() })

      expect(update).toHaveBeenCalledWith('custom-1', expect.objectContaining({ toolFilter: { allow: ['read_file'] } }))
    } finally {
      unmountSection(container, root)
    }
  })
})
