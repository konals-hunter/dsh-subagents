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
) {
  const store = createSnapshotStore({ status: 'ready' as const, profiles })
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

describe('SubagentsSection', () => {
  it('renders builtin profiles without a delete action', () => {
    const injected = renderSection()
    const { container, root } = mountSection(injected)

    expect(container.textContent).toContain('Explore')
    expect(container.textContent).not.toContain('删除')
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
})
