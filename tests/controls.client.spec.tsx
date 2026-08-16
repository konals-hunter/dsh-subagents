/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, type ReactNode } from 'react'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { EffortSelect, type EffortOption } from '../src/client/EffortSelect.tsx'
import { Switch } from '../src/client/Switch.tsx'

function mount(node: ReactNode): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { container, root }
}

function unmount(container: HTMLDivElement, root: ReturnType<typeof createRoot>): void {
  act(() => { root.unmount() })
  container.remove()
}

const groups = [{
  id: 'jiyuan',
  name: 'Jiyuan',
  models: [
    { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' },
    { id: 'deepseek-v4-0731', name: 'DeepSeek V4 0731' },
  ],
}]

describe('ModelSelect', () => {
  it('shows the current provider/model and selects a model directly', () => {
    const onSelect = vi.fn()
    const { container, root } = mount(
      <ModelSelect
        modelProvider="jiyuan"
        model="deepseek-v4-flash-0731"
        groups={groups}
        status="ready"
        onSelect={onSelect}
      />,
    )
    try {
      const trigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('jiyuan / deepseek-v4-flash-0731'))
      expect(trigger).toBeDefined()

      act(() => { trigger?.click() })
      expect(container.textContent).toContain('Jiyuan')
      expect(container.textContent).toContain('DeepSeek V4 0731')

      const modelRow = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('DeepSeek V4 0731'))
      expect(modelRow).toBeDefined()
      act(() => { modelRow?.click() })
      expect(onSelect).toHaveBeenCalledWith('jiyuan', 'deepseek-v4-0731')
    } finally {
      unmount(container, root)
    }
  })
})

describe('EffortSelect', () => {
  it('shows the current effort and emits the chosen variant', () => {
    const onChange = vi.fn()
    const options: EffortOption[] = [
      { value: null, label: 'Default' },
      { value: 'low', label: 'low' },
      { value: 'high', label: 'high' },
    ]
    const { container, root } = mount(
      <EffortSelect value="low" options={options} onChange={onChange} />,
    )
    try {
      const trigger = [...container.querySelectorAll('button')].find(button => button.textContent === 'low')
      expect(trigger).toBeDefined()
      act(() => { trigger?.click() })

      const highRow = [...container.querySelectorAll('button')].find(button => button.textContent === 'high')
      expect(highRow).toBeDefined()
      act(() => { highRow?.click() })
      expect(onChange).toHaveBeenCalledWith('high')
    } finally {
      unmount(container, root)
    }
  })
})

describe('Switch', () => {
  it('is a role=switch and calls onChange with the next value', () => {
    const onChange = vi.fn()
    const { container, root } = mount(<Switch checked={false} onChange={onChange} ariaLabel="Enable profile" />)
    try {
      const switchButton = container.querySelector('button[role="switch"]') as HTMLButtonElement | null
      expect(switchButton).not.toBeNull()
      expect(switchButton?.getAttribute('aria-checked')).toBe('false')

      act(() => { switchButton?.click() })
      expect(onChange).toHaveBeenCalledWith(true)
    } finally {
      unmount(container, root)
    }
  })
})
