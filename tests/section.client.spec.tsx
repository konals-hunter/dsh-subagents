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

const profile: SubagentProfile = {
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

function renderSection(overrides: Partial<SubagentsSectionInjected> = {}) {
  const store = createSnapshotStore({ status: 'ready' as const, profiles: [profile] })
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

describe('SubagentsSection', () => {
  it('renders builtin profiles without a delete action', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const injected = renderSection()
    await act(async () => {
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
    expect(container.textContent).toContain('Explore')
    expect(container.textContent).toContain('Explore')
    await act(async () => { root.unmount() })
    container.remove()
  })
})
