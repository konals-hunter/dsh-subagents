/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { ToolMultiSelect } from '../src/client/ToolMultiSelect.tsx'

function renderMultiSelect(props: {
  value?: string[]
  tools?: string[]
  onChange?: (next: string[]) => void
} = {}) {
  const value = props.value ?? []
  const tools = props.tools ?? ['read_file', 'write_file', 'bash']
  const onChange = props.onChange ?? vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ToolMultiSelect
        value={value}
        tools={tools}
        onChange={onChange}
        ariaLabel="tool filter"
      />
    )
  })
  return { container, root, onChange }
}

describe('ToolMultiSelect', () => {
  it('renders placeholder when empty', () => {
    const { container } = renderMultiSelect({ value: [] })
    expect(container.textContent).toContain('Select tools')
  })

  it('renders the selected name when one item is selected', () => {
    const { container } = renderMultiSelect({ value: ['read_file'] })
    expect(container.textContent).toContain('read_file')
  })

  it('renders first few names when 1-2 selected', () => {
    const { container } = renderMultiSelect({ value: ['read_file', 'write_file'] })
    expect(container.textContent).toContain('read_file, write_file')
  })

  it('renders selected count when three or more items are selected', () => {
    const { container } = renderMultiSelect({ value: ['read_file', 'write_file', 'bash'] })
    expect(container.textContent).toContain('3 selected')
  })

  it('toggles a tool on click and keeps menu open', async () => {
    const onChange = vi.fn()
    const { container, root } = renderMultiSelect({ value: [], onChange })
    try {
      const trigger = [...container.querySelectorAll('button')].find(btn => btn.textContent?.includes('Select tools'))
      expect(trigger).toBeDefined()
      await act(async () => { trigger?.click() })

      const readFileRow = [...container.querySelectorAll('button')].find(btn => btn.textContent === 'read_file')
      expect(readFileRow).toBeDefined()
      await act(async () => { readFileRow?.click() })

      expect(onChange).toHaveBeenCalledWith(['read_file'])
      // menu should still be open (aria-expanded remains true)
      const expanded = container.querySelector('[aria-expanded="true"]')
      expect(expanded).not.toBeNull()
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })
})
