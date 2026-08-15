/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { SubagentsSection } from '../src/client/SubagentsSection.tsx'
import type { SubagentsSectionInjected } from '../src/client/SubagentsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentProfile } from '../src/protocol.ts'

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

function renderSection(
  overrides: Partial<SubagentsSectionInjected> = {},
  profiles: SubagentProfile[] = [builtinProfile],
  corrupt = false,
) {
  const store = createSnapshotStore({ status: 'ready' as const, profiles, corrupt })
  const base: SubagentsSectionInjected = {
    hooks: { subagents: store },
    load: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    restoreBuiltins: vi.fn(async () => {}),
  }
  return { store, ...base, ...overrides }
}

function mountSection(injected: ReturnType<typeof renderSection>): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<SubagentsSection
      useSubagents={selector => selector(injected.store.getSnapshot())}
      useSessions={selector => selector({} as never)}
      useWorkspaces={selector => selector({} as never)}
      t={key => (zh as Record<string, string>)[key]}
      close={vi.fn()}
      load={injected.load}
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

  it('shows a corruption banner when the store is corrupt', () => {
    const injected = renderSection({}, [builtinProfile], true)
    const { container, root } = mountSection(injected)

    expect(container.textContent).toContain('配置文件已损坏')
    unmountSection(container, root)
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

      const reasoningEffort = fieldByLabel(container, 'Thinking Variant') as HTMLSelectElement
      const maxTokens = fieldByLabel(container, '最大输出 Tokens') as HTMLInputElement
      const maxDepth = fieldByLabel(container, '最大委派深度') as HTMLInputElement
      expect(reasoningEffort).not.toBeNull()
      expect(maxTokens).not.toBeNull()
      expect(maxDepth).not.toBeNull()

      await act(async () => {
        changeField(reasoningEffort, '')
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
})
