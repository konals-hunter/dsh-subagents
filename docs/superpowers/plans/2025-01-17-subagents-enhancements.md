# Subagents Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tool multi-select controls to the Subagents settings editor and add an `imagePath` flow to the `subagent_profile` tool, plus README screenshot documentation.

**Architecture:** Two independent enhancements. Enhancement 1 adds a host route + client API + controller + React component to replace comma-separated tool filter inputs with official-style multi-select menus. Enhancement 2 adds an optional `imagePath` parameter that prepends a `read_image` instruction to the subagent prompt. Both share the existing settings-section inject face and are covered by unit/integration tests.

**Tech Stack:** TypeScript, React 18, Vitest, DSH primitives (`Button`, `Menu`), `SnapshotStore` from `@deepseek-ai/dsh-client-runtime/client`.

## Global Constraints

- Branch: `feat/subagents`; latest commit `d13ef22`.
- All new code must pass `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Reuse existing CSS token classes (`effortSelectTrigger`, `selectValue`, `selectChevron`) where possible.
- Keep existing locale keys (`form.toolFilterAllow`, `form.toolFilterDeny`) stable.
- Screenshot `screenshots/ScreenShot_2026-08-16_130641_672.png` already exists and is not gitignored.

---

### Task 1: Host route and protocol constant

**Files:**
- Modify: `src/protocol.ts`
- Modify: `src/routes.ts`
- Modify: `src/index.ts`
- Test: `tests/routes.spec.ts`

**Interfaces:**
- Consumes: none
- Produces: `SUBAGENTS_API.tools`, updated `makeRoutes` deps signature, `ctx.tools` passed into `makeRoutes`

- [ ] **Step 1: Write the failing test**

In `tests/routes.spec.ts`, add a test that calls the new `/api/dsh-subagents/tools` route and expects a 200 response with `{ tools: [...] }`.

```ts
it('lists available tool names from ctx.tools.schemas()', async () => {
  const tools = [{ name: 'read_file' }, { name: 'write_file' }] as const
  const { routes } = makeRoutes({
    store,
    tools: {
      schemas: () => tools,
    } as never,
  })
  const route = routes.find(r => r.kind === 'exact' && r.path === '/api/dsh-subagents/tools')
  expect(route).toBeDefined()
  const response = await callHandler(route!, 'GET', '/api/dsh-subagents/tools')
  expect(response.status).toBe(200)
  expect((response.json as { tools: string[] }).tools).toEqual(['read_file', 'write_file'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/routes.spec.ts`
Expected: FAIL with type error or route not found.

- [ ] **Step 3: Write minimal implementation**

Update `src/protocol.ts`:

```ts
/** Route family constants shared with the browser half. */
export const SUBAGENTS_API = {
  profiles: '/api/dsh-subagents/profiles',
  restoreBuiltins: '/api/dsh-subagents/profiles/restore-builtins',
  tools: '/api/dsh-subagents/tools',
} as const
```

Update `src/routes.ts` signature and add route:

```ts
export function makeRoutes(deps: { store: SubagentStore; tools: { schemas(): { name: string }[] } }): { routes: WebRoute[] } {
  const { store, tools } = deps
  // ... existing routes array, then append:
  {
    kind: 'exact',
    path: SUBAGENTS_API.tools,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') }); return }
      try {
        writeJson(res, 200, { tools: tools.schemas().map(schema => schema.name) })
      } catch (error) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
```

Update `src/index.ts`:

```ts
const { routes } = makeRoutes({ store, tools: ctx.tools })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/routes.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protocol.ts src/routes.ts src/index.ts tests/routes.spec.ts
git commit -m "feat(subagents): expose /api/dsh-subagents/tools route"
```

---

### Task 2: Client API listTools and ToolCatalogController

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/ToolCatalogController.ts`
- Test: `tests/controller.spec.ts` (or create new `tests/tool-catalog.spec.ts`)

**Interfaces:**
- Consumes: `SUBAGENTS_API.tools`
- Produces: `SubagentsApi.listTools()`, `ToolCatalogController`, `ToolCatalogState`

- [ ] **Step 1: Write the failing tests**

Create `tests/tool-catalog.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ToolCatalogController } from '../src/client/ToolCatalogController.ts'

describe('ToolCatalogController', () => {
  it('starts idle and updates to loading then ready with tool names', async () => {
    const api = { listTools: vi.fn(async () => ({ tools: ['read_file', 'write_file'] })) } as never
    const controller = new ToolCatalogController(api as never)
    expect(controller.store.getSnapshot()).toEqual({ status: 'idle', tools: [] })

    await controller.load()
    expect(api.listTools).toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', tools: ['read_file', 'write_file'] })
  })

  it('surfaces listTools errors in the store', async () => {
    const api = { listTools: vi.fn(async () => { throw new Error('network boom') }) } as never
    const controller = new ToolCatalogController(api as never)

    await controller.load()
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.tools).toEqual([])
    expect(snapshot.error).toBe('network boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/tool-catalog.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Update `src/client/api.ts`:

```ts
export interface ToolsResponse {
  tools: string[]
}

export class SubagentsApi {
  // ... existing methods

  async listTools(): Promise<ToolsResponse> {
    const response = await fetch(SUBAGENTS_API.tools)
    return await readJson<ToolsResponse>(response)
  }
}
```

Create `src/client/ToolCatalogController.ts`:

```ts
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentsApi } from './api.ts'

export interface ToolCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  tools: string[]
  error?: string
}

export class ToolCatalogController {
  readonly store: SnapshotStore<ToolCatalogState> = createSnapshotStore<ToolCatalogState>({
    status: 'idle',
    tools: [],
  })

  constructor(private readonly api: Pick<SubagentsApi, 'listTools'>) {}

  async load(): Promise<void> {
    this.store.update(draft => {
      draft.status = 'loading'
      draft.error = undefined
    })
    try {
      const result = await this.api.listTools()
      this.store.set({ status: 'ready', tools: result.tools })
    } catch (error) {
      this.store.set({
        status: 'error',
        tools: this.store.getSnapshot().tools,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/tool-catalog.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/api.ts src/client/ToolCatalogController.ts tests/tool-catalog.spec.ts
git commit -m "feat(subagents): add client listTools API and ToolCatalogController"
```

---

### Task 3: ToolMultiSelect component and CSS

**Files:**
- Create: `src/client/ToolMultiSelect.tsx`
- Modify: `src/client/subagents.module.css`
- Test: `tests/tool-multi-select.spec.tsx`

**Interfaces:**
- Consumes: `Button`, `Menu` from `@deepseek-ai/dsh-client-ui-primitives`
- Produces: `ToolMultiSelect` component

- [ ] **Step 1: Write the failing tests**

Create `tests/tool-multi-select.spec.tsx`:

```tsx
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

  it('renders selected count when values present', () => {
    const { container } = renderMultiSelect({ value: ['read_file'] })
    expect(container.textContent).toContain('1 selected')
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
      // menu should still be open (no close handler fired on select)
      expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull()
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/tool-multi-select.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/client/ToolMultiSelect.tsx`:

```tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './subagents.module.css'

export interface ToolMultiSelectProps {
  value: readonly string[]
  tools: readonly string[]
  onChange: (next: string[]) => void
  size?: 'sm' | 'md'
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Render an official-style multi-select dropdown for tool names.
 * Selecting an item toggles it in the array and keeps the menu open.
 */
export function ToolMultiSelect({
  value,
  tools,
  onChange,
  size = 'md',
  placeholder = 'Select tools',
  ariaLabel,
  disabled = false,
}: ToolMultiSelectProps): ReactNode {
  const [open, setOpen] = useState(false)

  const selectedSet = new Set(value)
  const selectedCount = value.length

  const label = selectedCount === 0
    ? placeholder
    : selectedCount <= 2
      ? value.join(', ')
      : `${selectedCount} selected`

  const items: MenuEntry[] = tools.map(tool => ({
    id: tool,
    label: <span className={css.effortOption}>{tool}</span>,
  }))

  const handleSelect = (id: string): void => {
    const next = selectedSet.has(id)
      ? value.filter(item => item !== id)
      : [...value, id]
    onChange(next)
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      onSelect={handleSelect}
      selectedIds={value}
      items={items}
      dense
      className={css.toolSelect}
      anchor={
        <Button
          variant="outline"
          size={size}
          className={css.toolSelectTrigger}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.selectValue}>{label}</span>
          <IconChevronDownOutline14 className={css.selectChevron} />
        </Button>
      }
    />
  )
}
```

Add CSS classes to `src/client/subagents.module.css`:

```css
/* Tool multi-select trigger, aligned with model/effort select triggers. */
.toolSelect {
  display: inline-flex;
}

.toolSelectTrigger {
  max-width: 240px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/tool-multi-select.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/ToolMultiSelect.tsx src/client/subagents.module.css tests/tool-multi-select.spec.tsx
git commit -m "feat(subagents): add ToolMultiSelect component"
```

---

### Task 4: Wire ToolCatalogController into settings section

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/SubagentsSection.tsx`
- Test: `tests/client-index.spec.ts`, `tests/section.client.spec.tsx`

**Interfaces:**
- Consumes: `ToolCatalogController`, `ToolMultiSelect`
- Produces: updated inject face with `toolCatalog` and `loadTools`

- [ ] **Step 1: Write the failing tests**

Update `tests/client-index.spec.ts` to assert `toolCatalog` and `loadTools` are present in the inject face.

Update `tests/section.client.spec.tsx` `renderSection` to accept `toolCatalog` in injected hooks and pass `loadTools`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run tests/client-index.spec.ts tests/section.client.spec.tsx`
Expected: FAIL due to missing `toolCatalog`/`loadTools`.

- [ ] **Step 3: Write minimal implementation**

Update `src/client/index.ts`:

```ts
import { ToolCatalogController } from './ToolCatalogController.ts'

// inside apply:
const toolCatalog = new ToolCatalogController(api)

ctx.slots.inject('settings.section', () => ctx.slots.register({
  // ...
  inject: (): SubagentsSectionInjected => ({
    hooks: {
      subagents: controller.store,
      modelCatalog: modelCatalog.store,
      toolCatalog: toolCatalog.store,
    },
    load: () => controller.load(),
    loadModels: () => modelCatalog.load(),
    loadTools: () => toolCatalog.load(),
    // ...
  }),
}, SubagentsSection))
```

Update `src/client/SubagentsSection.tsx`:

```tsx
export interface SubagentsSectionInjected {
  hooks: {
    subagents: SnapshotStore<SubagentsSectionState>
    modelCatalog: SnapshotStore<ModelCatalogState>
    toolCatalog: SnapshotStore<ToolCatalogState>
  }
  load: () => Promise<void>
  loadModels: () => Promise<void>
  loadTools: () => Promise<void>
  // ...
}

// inside component:
const { useSubagents, useModelCatalog, useToolCatalog, t, load, loadModels, loadTools, create, update, remove, restoreBuiltins } = props
const catalog = useToolCatalog(snapshot => snapshot)

useEffect(() => { void loadTools() }, [loadTools])
```

Add import for `ToolCatalogState` and `useToolCatalog` binding via `InjectFace`.

Wait — `InjectFace` binds hooks by name. The existing pattern uses `hooks.subagents` and `hooks.modelCatalog` which become `useSubagents` and `useModelCatalog` props. So adding `toolCatalog` to `hooks` should automatically provide `useToolCatalog`. Verify this by checking how `InjectFace` works.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run tests/client-index.spec.ts tests/section.client.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/index.ts src/client/SubagentsSection.tsx tests/client-index.spec.ts tests/section.client.spec.tsx
git commit -m "feat(subagents): wire ToolCatalogController into settings section"
```

---

### Task 5: Replace tool filter text inputs with ToolMultiSelect

**Files:**
- Modify: `src/client/SubagentsSection.tsx`
- Test: `tests/section.client.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Add a test in `tests/section.client.spec.tsx` that verifies the tool filter allow/deny are rendered as multi-selects and that toggling them updates the draft.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run tests/section.client.spec.tsx`
Expected: FAIL because old `Input` fields are still there or new component isn't rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/client/SubagentsSection.tsx`, replace the two `Input` fields (lines 382-396) with:

```tsx
<label className={css.field}>
  <span className={css.fieldLabel}>{t('form.toolFilterAllow')}</span>
  <ToolMultiSelect
    value={draft.toolFilter?.allow ?? []}
    tools={catalog.tools}
    size="md"
    ariaLabel={t('form.toolFilterAllow')}
    onChange={allow => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, allow: allow.length > 0 ? allow : undefined } })}
  />
</label>
<label className={css.field}>
  <span className={css.fieldLabel}>{t('form.toolFilterDeny')}</span>
  <ToolMultiSelect
    value={draft.toolFilter?.deny ?? []}
    tools={catalog.tools}
    size="md"
    ariaLabel={t('form.toolFilterDeny')}
    onChange={deny => setDraft(current => current === null ? null : { ...current, toolFilter: { ...current.toolFilter, deny: deny.length > 0 ? deny : undefined } })}
  />
</label>
```

Add import for `ToolMultiSelect`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run tests/section.client.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/SubagentsSection.tsx tests/section.client.spec.tsx
git commit -m "feat(subagents): replace tool filter inputs with ToolMultiSelect"
```

---

### Task 6: Vision imagePath flow in tool.ts

**Files:**
- Modify: `src/tool.ts`
- Test: `tests/tool.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/tool.spec.ts`, add:

```ts
import { buildImageInstruction } from '../src/tool.ts'

describe('imagePath helper', () => {
  it('returns the exact instruction for a non-empty image path', () => {
    expect(buildImageInstruction('/path/to/image.png')).toBe(
      'You are analyzing the image at "/path/to/image.png".\n' +
      'First call the read_image tool with file_path "/path/to/image.png" to load the image into your context, then complete the requested task based on the image.'
    )
  })

  it('returns empty string for empty or undefined imagePath', () => {
    expect(buildImageInstruction('')).toBe('')
    expect(buildImageInstruction(undefined as unknown as string)).toBe('')
  })
})

describe('resolveProfileRequest with imagePath', () => {
  it('prepends image instruction before profile template and prompt', () => {
    const resolved = resolveProfileRequest(
      { profile: 'explore', prompt: 'Describe this.', imagePath: '/img.png' },
      { ...profile, promptTemplate: 'Explore first.' }
    )
    expect(resolved.prompt).toBe(
      'You are analyzing the image at "/img.png".\n' +
      'First call the read_image tool with file_path "/img.png" to load the image into your context, then complete the requested task based on the image.\n\n' +
      'Explore first.\n\nDescribe this.'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run tests/tool.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Update `src/tool.ts`:

```ts
export function buildImageInstruction(imagePath: string | undefined): string {
  if (typeof imagePath !== 'string' || imagePath.trim() === '') return ''
  const path = imagePath.trim()
  return `You are analyzing the image at "${path}".\nFirst call the read_image tool with file_path "${path}" to load the image into your context, then complete the requested task based on the image.`
}

export function resolveProfileRequest(
  args: { profile?: string; prompt: string; imagePath?: string },
  profile: SubagentProfile | undefined,
): {
  prompt: string
  agentOptions: SubagentProfileAgentOptions
  persona?: string
  toolFilter?: ToolFilter
  maxDepth?: number
} {
  const imageInstruction = buildImageInstruction(args.imagePath)
  const combinedPrompt = imageInstruction === ''
    ? (profile === undefined ? args.prompt : joinPrompt(profile.promptTemplate, args.prompt))
    : imageInstruction + '\n\n' + (profile === undefined ? args.prompt : joinPrompt(profile.promptTemplate, args.prompt))

  // ... rest of function uses combinedPrompt instead of inline prompt calc
}
```

Update tool description:

```ts
description: 'Delegate a task to a maintained subagent profile... ' +
  'When the task involves an image, pass `imagePath` so the subagent reads it with read_image first. ' +
  // ...
```

Add `imagePath?: string` to parameters schema.

In `execute`, pass `args.imagePath` to `resolveProfileRequest`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run tests/tool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tool.ts tests/tool.spec.ts
git commit -m "feat(subagents): add imagePath prompt instruction flow"
```

---

### Task 7: README screenshots

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Insert screenshot markdown near the top of README.md**

After the intro paragraph (line 5), add:

```md
![dsh-subagents settings screenshot](screenshots/ScreenShot_2026-08-16_130641_672.png)
```

- [ ] **Step 2: Insert screenshot markdown near the top of README.zh.md**

After the intro paragraph (line 4), add:

```md
![dsh-subagents 设置界面截图](screenshots/ScreenShot_2026-08-16_130641_672.png)
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs(subagents): add settings screenshot to READMEs"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

- [ ] **Step 3: Run build**

```bash
pnpm build
```

- [ ] **Step 4: Fix any failures**

If any step fails, fix and re-run until all pass.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(subagents): add tool multi-select and vision image path flow"
```
