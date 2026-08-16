# dsh-subagents Thinking Variant 配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 dsh-subagents 的 Thinking Variant 下拉按“手动配置优先、DSH 模型目录兜底”显示每个模型可用档位，并让 composer 模型面板使用同一套配置；首次启动自动 seed `stepfun / step-3.7-flash`。

**Architecture:** dsh-subagents 在 `~/.dsh/dsh-subagents.json` 新增 `modelThinkingConfigs`，通过 REST CRUD 暴露给 Settings UI；composer 所在的 vendor remote-web-ui 通过同一 REST 拉取手动配置并覆盖目录 reasoning 元数据。有效配置解析收敛到 `src/thinking.ts` 纯函数。

**Tech Stack:** TypeScript 5.7, React 18, Vitest, Cordis, pnpm, dsh-subagents plugin, vendor dsh-remote-web-ui plugin.

## Global Constraints

- 不修改 DSH harness 核心源码。
- `FORMAT_VERSION` 保持 `1`；`modelThinkingConfigs` 必须为可选字段。
- `ReasoningEffort` 改为任意非空字符串；`undefined`/`null` 表示跟随模型默认。
- 手动配置优先于目录元数据；两者都没有时 Subagents 下拉只显示“跟随模型默认”。
- 首次 seed 只在 `modelThinkingConfigs` 字段缺失时写入；字段已存在（包括 `[]`）不重新 seed。
- vendor composer 通过 `/m/api` 白名单方法 `dshSubagents.thinkingConfigs` 读取 dsh-subagents host 服务；失败时静默降级为 `[]`，不报错。禁止手机直接访问 loopback-only 的 `/api/dsh-subagents/*`。
- 所有 `/api/dsh-subagents/*` 路由保持 loopback-only。
- 提交信息遵循 conventional commits，禁止 emoji。

## File Structure

- `dsh-subagents/src/protocol.ts` — 共享类型 + API 路径。
- `dsh-subagents/src/thinking-configs.ts` — 默认 seed 配置。
- `dsh-subagents/src/thinking.ts` — 有效配置合并纯函数。
- `dsh-subagents/src/store.ts` — 存储、校验、CRUD、seed。
- `dsh-subagents/src/routes.ts` — REST 路由。
- `dsh-subagents/src/client/api.ts` — 浏览器 API。
- `dsh-subagents/src/client/controller.ts` — Settings 状态与动作。
- `dsh-subagents/src/client/SubagentsSection.tsx` — 动态下拉 + 配置管理区。
- `dsh-subagents/src/client/locales.ts` — 新文案。
- `dsh-subagents/README.md` / `README.zh.md` — 文档。
- `vendor/.../packages/dsh-remote-web-ui/src/mobile/api.ts` — composer 拉取配置。
- `vendor/.../packages/dsh-remote-web-ui/src/mobile/views/ChatView.tsx` — composer 合并配置。
- 对应 `tests/*` 文件。

---

### Task 1: 扩展 protocol 类型与 API 常量

**Files:**
- Modify: `dsh-subagents/src/protocol.ts`

**Interfaces:**
- Produces: `ReasoningEffort = string`、`ModelThinkingVariant`、`ModelThinkingConfig`、`ModelThinkingConfigPatch`、`SUBAGENTS_API.thinkingConfigs`。

- [ ] **Step 1: 修改 `src/protocol.ts`**

将 `export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'` 替换为：

```ts
/** Adapter 的 opaque thinking variant id；undefined 表示跟随模型默认。 */
export type ReasoningEffort = string

export interface ModelThinkingVariant {
  id: string
  name: string
  description?: string
}

export interface ModelThinkingConfig {
  provider: string
  model: string
  variants: ModelThinkingVariant[]
  defaultVariant?: string
}

export interface ModelThinkingConfigPatch {
  variants?: ModelThinkingVariant[]
  defaultVariant?: string | null
}
```

在 `SUBAGENTS_API` 中增加：

```ts
thinkingConfigs: '/api/dsh-subagents/thinking-configs',
```

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm --dir dsh-subagents typecheck`
Expected: PASS（目前没有引用旧枚举字面量导致类型错误）。

- [ ] **Step 3: Commit**

```bash
git -C dsh-subagents add src/protocol.ts
git -C dsh-subagents commit -m "feat(subagents): widen reasoning effort to opaque string and add thinking config types"
```

---

### Task 2: 默认 seed 配置

**Files:**
- Create: `dsh-subagents/src/thinking-configs.ts`

**Interfaces:**
- Produces: `DEFAULT_THINKING_CONFIGS: readonly ModelThinkingConfig[]`

- [ ] **Step 1: 创建 `src/thinking-configs.ts`**

```ts
import type { ModelThinkingConfig } from './protocol.ts'

export const DEFAULT_THINKING_CONFIGS: readonly ModelThinkingConfig[] = [
  {
    provider: 'stepfun',
    model: 'step-3.7-flash',
    variants: [
      { id: 'low', name: 'low' },
      { id: 'medium', name: 'medium' },
      { id: 'high', name: 'high' },
    ],
    defaultVariant: 'medium',
  },
]
```

- [ ] **Step 2: Commit**

```bash
git -C dsh-subagents add src/thinking-configs.ts
git -C dsh-subagents commit -m "feat(subagents): add default step-3.7-flash thinking config seed"
```

---

### Task 3: 有效配置合并纯函数

**Files:**
- Create: `dsh-subagents/src/thinking.ts`
- Test: `dsh-subagents/tests/thinking.spec.ts`

**Interfaces:**
- Produces: `EffectiveReasoning`, `findManualThinkingConfig`, `findCatalogReasoning`, `getEffectiveReasoning`, `getEffectiveDefaultEffort`.

- [ ] **Step 1: 写失败测试 `tests/thinking.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelThinkingConfig } from '../src/protocol.ts'
import { findCatalogReasoning, findManualThinkingConfig, getEffectiveDefaultEffort, getEffectiveReasoning } from '../src/thinking.ts'

const manual: ModelThinkingConfig[] = [
  {
    provider: 'stepfun',
    model: 'step-3.7-flash',
    variants: [
      { id: 'low', name: 'low' },
      { id: 'medium', name: 'medium' },
      { id: 'high', name: 'high' },
    ],
    defaultVariant: 'medium',
  },
]

const groups: ModelProviderGroup[] = [
  {
    id: 'jiyuan',
    name: 'Jiyuan',
    models: [
      {
        id: 'deepseek-v4-flash-0731',
        name: 'DeepSeek V4 Flash 0731',
        reasoning: {
          efforts: [{ id: 'off', name: 'off' }, { id: 'max', name: 'max' }],
          defaultEffort: 'max',
        },
      },
    ],
  },
]

describe('thinking config merge', () => {
  it('finds a manual config by provider and model', () => {
    expect(findManualThinkingConfig('stepfun', 'step-3.7-flash', manual)?.defaultVariant).toBe('medium')
    expect(findManualThinkingConfig('jiyuan', 'nope', manual)).toBeUndefined()
  })

  it('reads catalog reasoning when no manual config exists', () => {
    expect(findCatalogReasoning('jiyuan', 'deepseek-v4-flash-0731', groups)?.defaultEffort).toBe('max')
    expect(findCatalogReasoning('stepfun', 'step-3.7-flash', groups)).toBeUndefined()
  })

  it('prefers manual config over catalog reasoning', () => {
    const mixed = [
      ...manual,
      {
        provider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        variants: [{ id: 'low', name: 'low' }],
        defaultVariant: 'low',
      },
    ]
    expect(getEffectiveReasoning('jiyuan', 'deepseek-v4-flash-0731', mixed, groups)?.defaultEffort).toBe('low')
  })

  it('returns undefined when neither source has reasoning', () => {
    expect(getEffectiveReasoning('unknown', 'model', [], groups)).toBeUndefined()
  })

  it('resolves the effective default effort', () => {
    expect(getEffectiveDefaultEffort(getEffectiveReasoning('stepfun', 'step-3.7-flash', manual, []))).toBe('medium')
    expect(getEffectiveDefaultEffort(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir dsh-subagents test tests/thinking.spec.ts`
Expected: FAIL（`../src/thinking.ts` 不存在）。

- [ ] **Step 3: 创建 `src/thinking.ts`**

```ts
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelThinkingConfig, ModelThinkingVariant } from './protocol.ts'

export interface EffectiveReasoning {
  efforts: readonly ModelThinkingVariant[]
  defaultEffort?: string
}

export function findManualThinkingConfig(
  provider: string,
  model: string,
  configs: readonly ModelThinkingConfig[],
): ModelThinkingConfig | undefined {
  return configs.find(config => config.provider === provider && config.model === model)
}

export function findCatalogReasoning(
  provider: string,
  model: string,
  groups: readonly ModelProviderGroup[],
): EffectiveReasoning | undefined {
  const group = groups.find(entry => entry.id === provider)
  const entry = group?.models.find(candidate => candidate.id === model)
  if (entry?.reasoning === undefined) return undefined
  return {
    efforts: entry.reasoning.efforts.map(effort => ({
      id: effort.id,
      name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    })),
    ...(entry.reasoning.defaultEffort === undefined ? {} : { defaultEffort: entry.reasoning.defaultEffort }),
  }
}

export function getEffectiveReasoning(
  provider: string,
  model: string,
  manualConfigs: readonly ModelThinkingConfig[],
  groups: readonly ModelProviderGroup[],
): EffectiveReasoning | undefined {
  const manual = findManualThinkingConfig(provider, model, manualConfigs)
  if (manual !== undefined) {
    return {
      efforts: manual.variants,
      ...(manual.defaultVariant === undefined ? {} : { defaultEffort: manual.defaultVariant }),
    }
  }
  return findCatalogReasoning(provider, model, groups)
}

export function getEffectiveDefaultEffort(reasoning: EffectiveReasoning | undefined): string | undefined {
  return reasoning?.defaultEffort
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --dir dsh-subagents test tests/thinking.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C dsh-subagents add src/thinking.ts tests/thinking.spec.ts
git -C dsh-subagents commit -m "feat(subagents): add effective thinking variant merge helper"
```

---

### Task 4: Store 支持任意 reasoningEffort + thinking configs CRUD/seed

**Files:**
- Modify: `dsh-subagents/src/store.ts`
- Test: `dsh-subagents/tests/store.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_THINKING_CONFIGS`
- Produces:
  - `listThinkingConfigs(): ModelThinkingConfig[]`
  - `createThinkingConfig(payload: unknown): ModelThinkingConfig`
  - `updateThinkingConfig(provider: string, model: string, patch: unknown): ModelThinkingConfig`
  - `deleteThinkingConfig(provider: string, model: string): void`
  - `validateThinkingConfigPayload(payload: unknown): ModelThinkingConfig`
  - `validateThinkingConfigPatch(payload: unknown): ModelThinkingConfigPatch`

- [ ] **Step 1: 修改 `src/store.ts` 的 import 与 `StoreFile`**

在 `import type { ... } from './protocol.ts'` 中加入 `ModelThinkingConfig, ModelThinkingConfigPatch`，并加：

```ts
import { DEFAULT_THINKING_CONFIGS } from './thinking-configs.ts'
```

`StoreFile` 增加：

```ts
modelThinkingConfigs?: ModelThinkingConfig[]
```

- [ ] **Step 2: 替换 `parseReasoningEffort`**

```ts
function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new StoreClientError('reasoningEffort must be a non-empty string')
  const trimmed = value.trim()
  if (trimmed === '') throw new StoreClientError('reasoningEffort must be a non-empty string')
  return trimmed
}
```

- [ ] **Step 3: 增加 config 校验与 CRUD 辅助函数**

在 `parsePreset` 后追加：

```ts
function parseVariant(value: unknown): ModelThinkingVariant | undefined {
  if (!isRecord(value)) throw new StoreClientError('each variant must be an object')
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (id === '' || name === '') throw new StoreClientError('each variant must have non-empty id and name')
  let description: string | undefined
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') throw new StoreClientError('variant description must be a string')
    const trimmed = value.description.trim()
    if (trimmed === '') throw new StoreClientError('variant description must not be empty')
    description = trimmed
  }
  return { id, name, ...(description === undefined ? {} : { description }) }
}

export function validateThinkingConfigPayload(payload: unknown): ModelThinkingConfig {
  if (!isRecord(payload)) throw new StoreClientError('body must be a JSON object')
  const provider = typeof payload.provider === 'string' ? payload.provider.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (provider === '') throw new StoreClientError('provider is required')
  if (model === '') throw new StoreClientError('model is required')
  if (!Array.isArray(payload.variants) || payload.variants.length === 0) throw new StoreClientError('variants must be a non-empty array')
  const seen = new Set<string>()
  const variants = payload.variants.map(variant => {
    const parsed = parseVariant(variant)
    if (parsed === undefined) throw new StoreClientError('invalid variant')
    if (seen.has(parsed.id)) throw new StoreClientError('variant ids must be unique')
    seen.add(parsed.id)
    return parsed
  })
  let defaultVariant: string | undefined
  if (payload.defaultVariant !== undefined && payload.defaultVariant !== null) {
    if (typeof payload.defaultVariant !== 'string') throw new StoreClientError('defaultVariant must be a string')
    defaultVariant = payload.defaultVariant.trim()
    if (defaultVariant === '') throw new StoreClientError('defaultVariant must not be empty')
    if (!seen.has(defaultVariant)) throw new StoreClientError('defaultVariant must be one of the variant ids')
  }
  return { provider, model, variants, ...(defaultVariant === undefined ? {} : { defaultVariant }) }
}

export function validateThinkingConfigPatch(payload: unknown): ModelThinkingConfigPatch {
  if (!isRecord(payload)) throw new StoreClientError('body must be a JSON object')
  const patch: ModelThinkingConfigPatch = {}
  if (payload.variants !== undefined) {
    if (!Array.isArray(payload.variants) || payload.variants.length === 0) throw new StoreClientError('variants must be a non-empty array')
    const seen = new Set<string>()
    patch.variants = payload.variants.map(variant => {
      const parsed = parseVariant(variant)
      if (parsed === undefined) throw new StoreClientError('invalid variant')
      if (seen.has(parsed.id)) throw new StoreClientError('variant ids must be unique')
      seen.add(parsed.id)
      return parsed
    })
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'defaultVariant')) {
    const raw = payload.defaultVariant
    if (raw === null || raw === undefined) {
      patch.defaultVariant = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed === '') throw new StoreClientError('defaultVariant must not be empty')
      patch.defaultVariant = trimmed
    } else {
      throw new StoreClientError('defaultVariant must be a string or null')
    }
  }
  return patch
}

function isStoredModelThinkingConfig(value: unknown): value is ModelThinkingConfig {
  if (!isRecord(value)) return false
  if (!isStoredNonEmptyString(value.provider) || !isStoredNonEmptyString(value.model)) return false
  if (!Array.isArray(value.variants) || value.variants.length === 0) return false
  const seen = new Set<string>()
  for (const variant of value.variants) {
    if (!isRecord(variant) || !isStoredNonEmptyString(variant.id) || !isStoredNonEmptyString(variant.name)) return false
    if (seen.has(variant.id)) return false
    seen.add(variant.id)
    if (variant.description !== undefined && !isStoredNonEmptyString(variant.description)) return false
  }
  if (value.defaultVariant !== undefined && !isStoredNonEmptyString(value.defaultVariant)) return false
  if (value.defaultVariant !== undefined && !seen.has(value.defaultVariant)) return false
  return true
}

function hasDuplicateConfigKeys(configs: readonly ModelThinkingConfig[]): boolean {
  const seen = new Set<string>()
  for (const config of configs) {
    const key = config.provider + '\u0000' + config.model
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}
```

- [ ] **Step 4: 在 `load()` 校验中增加 configs**

将 `parsed.modelThinkingConfigs !== undefined && !isStoredContinuableProfiles(...)` 的校验扩展为：

```ts
(
  parsed.modelThinkingConfigs !== undefined &&
  (
    !Array.isArray(parsed.modelThinkingConfigs) ||
    !parsed.modelThinkingConfigs.every(isStoredModelThinkingConfig) ||
    hasDuplicateConfigKeys(parsed.modelThinkingConfigs as ModelThinkingConfig[])
  )
)
```

- [ ] **Step 5: 在 `read()` 中 seed 缺失字段**

在 `file.continuableProfiles ??= {}` 后追加：

```ts
if (file.modelThinkingConfigs === undefined) {
  file.modelThinkingConfigs = DEFAULT_THINKING_CONFIGS.map(config => ({
    ...config,
    variants: config.variants.map(variant => ({ ...variant })),
  }))
  changed = true
}
```

注意：不要用 `??= []` 后再合并，否则删除后会被重新 seed。`modelThinkingConfigs: []` 表示用户主动清空。

- [ ] **Step 6: 增加 Store 方法**

在 `restoreBuiltins()` 方法后追加：

```ts
listThinkingConfigs(): ModelThinkingConfig[] {
  return this.read().modelThinkingConfigs ?? []
}

createThinkingConfig(payload: unknown): ModelThinkingConfig {
  const config = validateThinkingConfigPayload(payload)
  const file = this.read()
  this.assertWritable()
  const key = config.provider + '\u0000' + config.model
  if ((file.modelThinkingConfigs ?? []).some(item => item.provider + '\u0000' + item.model === key)) {
    throw new StoreClientError('thinking config already exists for this provider and model')
  }
  file.modelThinkingConfigs ??= []
  file.modelThinkingConfigs.push(config)
  this.save(file)
  this.notify()
  return config
}

updateThinkingConfig(provider: string, model: string, patch: unknown): ModelThinkingConfig {
  const normalized = validateThinkingConfigPatch(patch)
  const file = this.read()
  this.assertWritable()
  const config = (file.modelThinkingConfigs ?? []).find(item => item.provider === provider && item.model === model)
  if (config === undefined) throw new StoreClientError('thinking config not found')
  if (normalized.variants !== undefined) config.variants = normalized.variants
  if (Object.prototype.hasOwnProperty.call(normalized, 'defaultVariant')) {
    config.defaultVariant = normalized.defaultVariant ?? undefined
  }
  if (config.defaultVariant !== undefined && !config.variants.some(variant => variant.id === config.defaultVariant)) {
    throw new StoreClientError('defaultVariant must be one of the variant ids')
  }
  this.save(file)
  this.notify()
  return config
}

deleteThinkingConfig(provider: string, model: string): void {
  const file = this.read()
  this.assertWritable()
  const configs = file.modelThinkingConfigs ?? []
  const index = configs.findIndex(item => item.provider === provider && item.model === model)
  if (index < 0) throw new StoreClientError('thinking config not found')
  configs.splice(index, 1)
  this.save(file)
  this.notify()
}
```

- [ ] **Step 7: 更新 `tests/store.spec.ts` 中与固定枚举相关的断言**

将 `it('validates payloads')` 中的：

```ts
expect(() => validateProfilePayload(payload({ reasoningEffort: 'ultra' as never }))).toThrow(/reasoningEffort/)
```

替换为：

```ts
expect(validateProfilePayload(payload({ reasoningEffort: 'ultra' as never })).reasoningEffort).toBe('ultra')
```

并将 `it('treats valid JSON with malformed optional fields as corrupt')` 中的 `{ reasoningEffort: 'ultra' }` 从 `malformedOptions` 数组删除（现在它是合法值）。

- [ ] **Step 8: 在 `tests/store.spec.ts` 末尾追加 config CRUD/seed 测试**

先更新 import：

```ts
import { SubagentStore, validateProfilePatch, validateProfilePayload, validateThinkingConfigPayload } from '../src/store.ts'
```

然后追加：

```ts
describe('thinking configs', () => {
  it('seeds step-3.7-flash only when modelThinkingConfigs field is missing', () => {
    const { store, dir } = tempStore()
    try {
      store.list()
      let raw = JSON.parse(readFileSync(store.path, 'utf8')) as {
        modelThinkingConfigs?: Array<{ provider: string; model: string; defaultVariant?: string }>
      }
      expect(raw.modelThinkingConfigs).toEqual([
        expect.objectContaining({ provider: 'stepfun', model: 'step-3.7-flash', defaultVariant: 'medium' }),
      ])

      // Empty array is respected: deletion stays deleted.
      raw.modelThinkingConfigs = []
      writeFileSync(store.path, JSON.stringify(raw, null, 2))
      const reloaded = new SubagentStore(store.path)
      expect(reloaded.listThinkingConfigs()).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('CRUDs a custom thinking config and enforces uniqueness', () => {
    const { store, dir } = tempStore()
    try {
      store.list()
      const created = store.createThinkingConfig({
        provider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        variants: [{ id: 'off', name: 'off' }, { id: 'max', name: 'max' }],
        defaultVariant: 'max',
      })
      expect(created.defaultVariant).toBe('max')
      expect(() => store.createThinkingConfig({
        provider: 'jiyuan',
        model: 'deepseek-v4-flash-0731',
        variants: [{ id: 'low', name: 'low' }],
      })).toThrow(/already exists|已存在/)

      const updated = store.updateThinkingConfig('jiyuan', 'deepseek-v4-flash-0731', {
        variants: [{ id: 'low', name: 'low' }],
        defaultVariant: null,
      })
      expect(updated.variants).toEqual([{ id: 'low', name: 'low' }])
      expect(updated.defaultVariant).toBeUndefined()

      store.deleteThinkingConfig('jiyuan', 'deepseek-v4-flash-0731')
      expect(store.listThinkingConfigs().some(c => c.model === 'deepseek-v4-flash-0731')).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('validates config payloads', () => {
    expect(() => validateThinkingConfigPayload({ provider: '', model: 'm', variants: [{ id: 'a', name: 'A' }] })).toThrow(/provider/)
    expect(() => validateThinkingConfigPayload({ provider: 'p', model: 'm', variants: [] })).toThrow(/variants/)
    expect(() => validateThinkingConfigPayload({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }], defaultVariant: 'b' })).toThrow(/defaultVariant/)
  })
})
```

`tempStore()` 内的 `store.list()` 已会自动 seed；测试使用 `store.listThinkingConfigs()` 前可先 `store.list()`。

- [ ] **Step 9: 运行测试**

Run: `pnpm --dir dsh-subagents test tests/store.spec.ts tests/thinking.spec.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git -C dsh-subagents add src/store.ts src/thinking-configs.ts tests/store.spec.ts
git -C dsh-subagents commit -m "feat(subagents): store per-model thinking variant configs"
```

---

### Task 5: REST 路由

**Files:**
- Modify: `dsh-subagents/src/routes.ts`
- Test: `dsh-subagents/tests/routes.spec.ts`

**Interfaces:**
- Consumes: `store.listThinkingConfigs/createThinkingConfig/updateThinkingConfig/deleteThinkingConfig`, `validateThinkingConfigPayload`, `validateThinkingConfigPatch`.
- Produces: `/api/dsh-subagents/thinking-configs` GET/POST/PUT/DELETE。

- [ ] **Step 1: 在 `src/routes.ts` import 中增加校验函数**

```ts
import { StoreClientError, validateProfilePatch, validateProfilePayload, validateThinkingConfigPayload, validateThinkingConfigPatch } from './store.ts'
```

- [ ] **Step 2: 在 routes 数组中追加一个 route**

在 `modelInfo` route 之后、数组结束前插入：

```ts
{
  kind: 'exact',
  path: SUBAGENTS_API.thinkingConfigs,
  handler: async (req, res) => {
    if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      try {
        writeJson(res, 200, { configs: store.listThinkingConfigs() })
      } catch (error) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (method === 'POST') {
      const body = await readJsonBody(req)
      if (body === BODY_TOO_LARGE) { writeJson(res, 413, { error: 'request body too large' }); return }
      if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
      try {
        const config = store.createThinkingConfig(validateThinkingConfigPayload(body))
        writeJson(res, 201, { config })
      } catch (error) {
        writeJson(res, error instanceof StoreClientError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (method !== 'PUT' && method !== 'DELETE') { writeJson(res, 405, { error: 'method not allowed: ' + method }); return }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const provider = queryParam(url, 'provider')
    const model = queryParam(url, 'model')
    if (provider === undefined || provider === '' || model === undefined || model === '') {
      writeJson(res, 400, { error: 'provider and model query parameters are required' })
      return
    }
    try {
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        if (body === BODY_TOO_LARGE) { writeJson(res, 413, { error: 'request body too large' }); return }
        if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
        const config = store.updateThinkingConfig(provider, model, validateThinkingConfigPatch(body))
        writeJson(res, 200, { config })
      } else {
        store.deleteThinkingConfig(provider, model)
        writeJson(res, 200, { ok: true })
      }
    } catch (error) {
      writeJson(res, error instanceof StoreClientError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) })
    }
  },
},
```

- [ ] **Step 3: 在 `tests/routes.spec.ts` 中追加 CRUD 测试**

```ts
it('CRUDs thinking configs through the REST API', async () => {
  const created = await request('/api/dsh-subagents/thinking-configs', 'POST', {
    provider: 'stepfun',
    model: 'step-3.7-flash',
    variants: [{ id: 'low', name: 'low' }, { id: 'medium', name: 'medium' }],
    defaultVariant: 'medium',
  })
  expect(created.status).toBe(400) // step-3.7-flash already seeded; duplicate rejected

  const custom = await request('/api/dsh-subagents/thinking-configs', 'POST', {
    provider: 'jiyuan',
    model: 'deepseek-v4-flash-0731',
    variants: [{ id: 'off', name: 'off' }],
  })
  expect(custom.status).toBe(201)
  const query = 'provider=jiyuan&model=deepseek-v4-flash-0731'

  const listed = await request('/api/dsh-subagents/thinking-configs')
  expect(listed.status).toBe(200)
  expect((listed.json as { configs: Array<{ provider: string }> }).configs.some(c => c.provider === 'jiyuan')).toBe(true)

  const updated = await request('/api/dsh-subagents/thinking-configs?' + query, 'PUT', {
    defaultVariant: 'off',
  })
  expect(updated.status).toBe(200)
  expect((updated.json as { config: { defaultVariant?: string } }).config.defaultVariant).toBe('off')

  const deleted = await request('/api/dsh-subagents/thinking-configs?' + query, 'DELETE')
  expect(deleted.status).toBe(200)
})
```

- [ ] **Step 4: 运行路由测试**

Run: `pnpm --dir dsh-subagents test tests/routes.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C dsh-subagents add src/routes.ts tests/routes.spec.ts
git -C dsh-subagents commit -m "feat(subagents): add thinking config REST routes"
```

---

### Task 6: 浏览器 API 与 controller

**Files:**
- Modify: `dsh-subagents/src/client/api.ts`
- Modify: `dsh-subagents/src/client/controller.ts`
- Test: `dsh-subagents/tests/controller.spec.ts`

**Interfaces:**
- Consumes: `ModelThinkingConfig`, `ModelThinkingConfigPatch`.
- Produces: `SubagentsApi.listThinkingConfigs/createThinkingConfig/updateThinkingConfig/deleteThinkingConfig`; `SubagentsSectionState.thinkingConfigs`; controller methods.

- [ ] **Step 1: 扩展 `src/client/api.ts`**

在 import 中加入 `ModelThinkingConfig, ModelThinkingConfigPatch`。增加接口与方法：

```ts
export interface ThinkingConfigsResponse {
  configs: ModelThinkingConfig[]
}
```

在类内追加：

```ts
async listThinkingConfigs(): Promise<ThinkingConfigsResponse> {
  const response = await fetch(SUBAGENTS_API.thinkingConfigs)
  return await readJson<ThinkingConfigsResponse>(response)
}

async createThinkingConfig(payload: ModelThinkingConfig): Promise<ModelThinkingConfig> {
  const response = await fetch(SUBAGENTS_API.thinkingConfigs, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await readJson<{ config: ModelThinkingConfig }>(response)
  return body.config
}

async updateThinkingConfig(provider: string, model: string, patch: ModelThinkingConfigPatch): Promise<ModelThinkingConfig> {
  const response = await fetch(SUBAGENTS_API.thinkingConfigs + query({ provider, model }), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await readJson<{ config: ModelThinkingConfig }>(response)
  return body.config
}

async deleteThinkingConfig(provider: string, model: string): Promise<void> {
  const response = await fetch(SUBAGENTS_API.thinkingConfigs + query({ provider, model }), { method: 'DELETE' })
  await readJson<{ ok: boolean }>(response)
}
```

- [ ] **Step 2: 扩展 `src/client/controller.ts`**

`SubagentsSectionState` 增加：

```ts
thinkingConfigs: ModelThinkingConfig[]
```

初始 store 改为：

```ts
{ status: 'loading', profiles: [], thinkingConfigs: [] }
```

`load()` 改为：

```ts
const [profiles, configs] = await Promise.all([this.api.listProfiles(), this.api.listThinkingConfigs()])
this.store.set({ status: 'ready', profiles: profiles.profiles, thinkingConfigs: configs.configs, corrupt: profiles.corrupt })
```

`load()` 的 catch 分支也要包含新字段：

```ts
this.store.set({ status: 'error', profiles: [], thinkingConfigs: [], error: error instanceof Error ? error.message : String(error) })
```

`restoreBuiltins()` 中保留现有 configs：

```ts
this.store.update(draft => {
  draft.status = 'ready'
  draft.profiles = result.profiles
  draft.corrupt = result.corrupt
  draft.error = result.error
  if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
})
```

在所有其他 `this.store.update(draft => { ... })` 的 profile 操作中，如果 `draft` 没有 `thinkingConfigs` 字段，需要保留现有值：

```ts
if (draft.thinkingConfigs === undefined) draft.thinkingConfigs = []
```

新增方法：

```ts
async createThinkingConfig(payload: ModelThinkingConfig): Promise<void> {
  const config = await this.api.createThinkingConfig(payload)
  this.store.update(draft => {
    draft.thinkingConfigs.push(config)
    draft.corrupt = false
    draft.error = undefined
  })
}

async updateThinkingConfig(provider: string, model: string, patch: ModelThinkingConfigPatch): Promise<void> {
  const config = await this.api.updateThinkingConfig(provider, model, patch)
  this.store.update(draft => {
    const index = draft.thinkingConfigs.findIndex(item => item.provider === provider && item.model === model)
    if (index >= 0) draft.thinkingConfigs[index] = config
    draft.corrupt = false
    draft.error = undefined
  })
}

async deleteThinkingConfig(provider: string, model: string): Promise<void> {
  await this.api.deleteThinkingConfig(provider, model)
  this.store.update(draft => {
    draft.thinkingConfigs = draft.thinkingConfigs.filter(item => !(item.provider === provider && item.model === model))
    draft.corrupt = false
    draft.error = undefined
  })
}
```

- [ ] **Step 3: 更新 `tests/controller.spec.ts`**

所有 mock `api` 的 `listProfiles` 旁增加 `listThinkingConfigs`：

```ts
listThinkingConfigs: async () => ({ configs: [] }),
```

新增测试：

```ts
it('loads thinking configs into the store', async () => {
  const api = {
    listProfiles: async () => ({ profiles: [profile], corrupt: false }),
    listThinkingConfigs: async () => ({ configs: [{ provider: 'stepfun', model: 'step-3.7-flash', variants: [{ id: 'low', name: 'low' }], defaultVariant: 'low' }] }),
  } as never
  const controller = new SubagentsSectionController(api as never)
  await controller.load()
  expect(controller.store.getSnapshot().thinkingConfigs[0]?.model).toBe('step-3.7-flash')
})

it('passes thinking config CRUD through to the API', async () => {
  const create = vi.fn(async () => ({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] }))
  const update = vi.fn(async () => ({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] }))
  const del = vi.fn(async () => {})
  const controller = new SubagentsSectionController({ createThinkingConfig: create, updateThinkingConfig: update, deleteThinkingConfig: del } as never)
  await controller.createThinkingConfig({ provider: 'p', model: 'm', variants: [{ id: 'a', name: 'A' }] })
  await controller.updateThinkingConfig('p', 'm', { defaultVariant: 'a' })
  await controller.deleteThinkingConfig('p', 'm')
  expect(create).toHaveBeenCalled()
  expect(update).toHaveBeenCalledWith('p', 'm', { defaultVariant: 'a' })
  expect(del).toHaveBeenCalledWith('p', 'm')
})
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --dir dsh-subagents test tests/controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C dsh-subagents add src/client/api.ts src/client/controller.ts tests/controller.spec.ts
git -C dsh-subagents commit -m "feat(subagents): load and manage thinking configs from settings controller"
```

---

### Task 7: Subagents UI 动态 variants + 配置管理区

**Files:**
- Modify: `dsh-subagents/src/client/SubagentsSection.tsx`
- Modify: `dsh-subagents/src/client/index.ts`
- Modify: `dsh-subagents/src/client/locales.ts`
- Modify: `dsh-subagents/src/client/subagents.module.css`（新增 `.sectionBlock` / `.sectionTitle`）
- Test: `dsh-subagents/tests/section.client.spec.tsx`

**Interfaces:**
- Consumes: `getEffectiveReasoning`, `getEffectiveDefaultEffort`, `thinkingConfigs` state, controller config methods.
- Produces: 动态 EffortSelect、切模型自动默认、配置管理区。

- [ ] **Step 1: 更新 `src/client/locales.ts`**

在 zh/en 字典中追加以下 keys（key 源为 zh，en 同步）：

```ts
'config.title': '模型 Thinking Variant 配置',
'config.empty': '还没有模型 Thinking Variant 配置',
'config.add': '新增配置',
'config.edit': '编辑配置',
'config.delete': '删除配置',
'config.providerModel': 'Provider / 模型',
'config.variants': '可用 Thinking Variants',
'config.variantsPlaceholder': '每行一个 variant，格式 id=显示名（可选 |描述）\n例如：low=低档',
'config.defaultVariant': '默认 Variant（留空=跟随模型默认）',
'config.save': '保存配置',
'config.cancel': '取消',
```

- [ ] **Step 2: 在 `SubagentsSection.tsx` 中 import helper**

```ts
import { getEffectiveDefaultEffort, getEffectiveReasoning } from '../thinking.ts'
import type { ModelThinkingConfig, ModelThinkingConfigPatch, ModelThinkingVariant } from '../protocol.ts'
```

- [ ] **Step 3: 增加解析/选项辅助函数**

在 `normalizeToolFilterDraft` 后追加：

```ts
function parseVariantsText(text: string): ModelThinkingVariant[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => {
    const [rawId, ...rest] = line.split('=')
    const id = (rawId ?? '').trim()
    const nameAndDescription = rest.join('=').trim()
    const [rawName, ...descriptionParts] = nameAndDescription.split('|')
    const name = (rawName ?? '').trim()
    const description = descriptionParts.join('|').trim()
    const variant: ModelThinkingVariant = { id, name }
    if (description !== '') variant.description = description
    return variant
  })
}

function effortOptionsFor(
  provider: string,
  model: string,
  groups: readonly ModelCatalogState['groups'],
  configs: readonly ModelThinkingConfig[],
  t: (key: string) => string,
): EffortOption[] {
  const reasoning = getEffectiveReasoning(provider, model, configs, groups)
  const options: EffortOption[] = [{ value: null, label: t('form.reasoningEffort.none') }]
  if (reasoning !== undefined) {
    for (const effort of reasoning.efforts) {
      options.push({ value: effort.id, label: effort.name })
    }
  }
  return options
}

interface ThinkingConfigDraft {
  provider: string
  model: string
  variantsText: string
  defaultVariant: string
}

function blankThinkingConfigDraft(): ThinkingConfigDraft {
  return { provider: '', model: '', variantsText: 'low=low\nmedium=medium\nhigh=high', defaultVariant: 'medium' }
}
```

- [ ] **Step 4: 替换硬编码 `effortOptions`**

删除现有 `effortOptions = useMemo(...)` 固定数组。列表卡片中的 EffortSelect 改为：

```tsx
<EffortSelect
  value={profile.reasoningEffort}
  options={effortOptionsFor(profile.modelProvider, profile.model, catalog.groups, state.thinkingConfigs, t)}
  ariaLabel={`${t('form.reasoningEffort')} ${profile.name}`}
  onChange={reasoningEffort => { void handleQuickUpdate(profile.id, { reasoningEffort }) }}
/>
```

编辑表单中的 EffortSelect 改为：

```tsx
<EffortSelect
  value={draft.reasoningEffort ?? null}
  options={effortOptionsFor(draft.modelProvider ?? '', draft.model ?? '', catalog.groups, state.thinkingConfigs, t)}
  size="md"
  onChange={reasoningEffort => setDraft(current => current === null ? null : { ...current, reasoningEffort })}
/>
```

- [ ] **Step 5: 切换模型自动默认**

列表卡片 `ModelSelect` 的 `onSelect` 改为：

```tsx
onSelect={(modelProvider, model) => {
  const reasoning = getEffectiveReasoning(modelProvider, model, state.thinkingConfigs, catalog.groups)
  void handleQuickUpdate(profile.id, {
    modelProvider,
    model,
    reasoningEffort: getEffectiveDefaultEffort(reasoning) ?? null,
  })
}}
```

编辑表单 `ModelSelect` 的 `onSelect` 改为：

```tsx
onSelect={(modelProvider, model) => {
  const reasoning = getEffectiveReasoning(modelProvider, model, state.thinkingConfigs, catalog.groups)
  setDraft(current => current === null ? null : {
    ...current,
    modelProvider,
    model,
    reasoningEffort: getEffectiveDefaultEffort(reasoning) ?? null,
  })
}}
```

- [ ] **Step 6: 增加配置管理区 state 与 handlers**

在组件内已有 state 后追加：

```ts
const [configEditor, setConfigEditor] = useState<{ mode: 'new' } | { mode: 'edit'; config: ModelThinkingConfig } | null>(null)
const [configDraft, setConfigDraft] = useState<ThinkingConfigDraft | null>(null)
const [configSaving, setConfigSaving] = useState(false)
const [configError, setConfigError] = useState<string | null>(null)

const openNewConfig = (): void => {
  setConfigEditor({ mode: 'new' })
  setConfigDraft(blankThinkingConfigDraft())
  setConfigError(null)
}
const openEditConfig = (config: ModelThinkingConfig): void => {
  setConfigEditor({ mode: 'edit', config })
  setConfigDraft({
    provider: config.provider,
    model: config.model,
    variantsText: config.variants.map(variant => variant.description === undefined ? `${variant.id}=${variant.name}` : `${variant.id}=${variant.name}|${variant.description}`).join('\n'),
    defaultVariant: config.defaultVariant ?? '',
  })
  setConfigError(null)
}
const closeConfig = (): void => {
  setConfigEditor(null)
  setConfigDraft(null)
  setConfigError(null)
}
const saveConfig = async (): Promise<void> => {
  if (configDraft === null) return
  const variants = parseVariantsText(configDraft.variantsText)
  if (variants.length === 0) { setConfigError('至少需要一行 variant'); return }
  const defaultVariant = configDraft.defaultVariant.trim() === '' ? undefined : configDraft.defaultVariant.trim()
  setConfigSaving(true)
  setConfigError(null)
  try {
    if (configEditor?.mode === 'new') {
      await createThinkingConfig({ provider: configDraft.provider, model: configDraft.model, variants, ...(defaultVariant === undefined ? {} : { defaultVariant }) })
    } else if (configEditor?.mode === 'edit') {
      const patch: ModelThinkingConfigPatch = { variants, ...(defaultVariant === undefined ? { defaultVariant: null } : { defaultVariant }) }
      await updateThinkingConfig(configEditor.config.provider, configEditor.config.model, patch)
    }
    closeConfig()
  } catch (cause) {
    setConfigError(cause instanceof Error ? cause.message : String(cause))
  } finally {
    setConfigSaving(false)
  }
}
const handleDeleteConfig = async (config: ModelThinkingConfig): Promise<void> => {
  setConfigError(null)
  try {
    await deleteThinkingConfig(config.provider, config.model)
  } catch (cause) {
    setConfigError(cause instanceof Error ? cause.message : String(cause))
  }
}
```

从 `props` 解构中加入 `createThinkingConfig, updateThinkingConfig, deleteThinkingConfig`。在 `SubagentsSectionInjected` 接口中增加：

```ts
createThinkingConfig: (payload: ModelThinkingConfig) => Promise<void>
updateThinkingConfig: (provider: string, model: string, patch: ModelThinkingConfigPatch) => Promise<void>
deleteThinkingConfig: (provider: string, model: string) => Promise<void>
```

同时在 `dsh-subagents/src/client/index.ts` 的 `inject` 返回对象中增加：

```ts
createThinkingConfig: payload => controller.createThinkingConfig(payload),
updateThinkingConfig: (provider, model, patch) => controller.updateThinkingConfig(provider, model, patch),
deleteThinkingConfig: (provider, model) => controller.deleteThinkingConfig(provider, model),
```

- [ ] **Step 7: 在 JSX 中追加配置管理区**

在 profile 列表块结束之后、`{editing !== null ...}` 之前插入：

```tsx
<div className={css.sectionBlock}>
  <div className={css.toolbar}>
    <h3 className={css.sectionTitle}>{t('config.title')}</h3>
    <Button variant="outline" size="md" onClick={openNewConfig}>{t('config.add')}</Button>
  </div>
  {configError !== null && <p className={css.error}>{configError}</p>}
  {state.thinkingConfigs.length === 0
    ? <p className={css.empty}>{t('config.empty')}</p>
    : (
      <div className={css.list}>
        {state.thinkingConfigs.map(config => (
          <div key={config.provider + '/' + config.model} className={css.card}>
            <div className={css.cardHeader}>
              <div className={css.cardIdentity}>
                <strong className={css.cardName}>{config.provider} / {config.model}</strong>
                <span className={css.cardId}>{config.variants.map(v => v.name).join(', ')}</span>
              </div>
              <div className={css.rowActions}>
                <Button variant="ghost" size="sm" onClick={() => openEditConfig(config)}>{t('config.edit')}</Button>
                <Button variant="ghost" size="sm" className={css.dangerButton} onClick={() => { void handleDeleteConfig(config) }}>{t('config.delete')}</Button>
              </div>
            </div>
            <p className={css.cardDescription}>
              {t('config.defaultVariant')}: {config.defaultVariant ?? t('form.reasoningEffort.none')}
            </p>
          </div>
        ))}
      </div>
    )}
  {configEditor !== null && configDraft !== null && (
    <div className={css.editor}>
      <h3 className={css.editorTitle}>{configEditor.mode === 'new' ? t('config.add') : t('config.edit')}</h3>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('form.model')}</span>
        <ModelSelect
          modelProvider={configDraft.provider}
          model={configDraft.model}
          groups={catalog.groups}
          status={catalog.status}
          size="md"
          ariaLabel={t('form.model')}
          loadingLabel={t('form.model.loading')}
          emptyLabel={t('form.model.empty')}
          onSelect={(modelProvider, model) => setConfigDraft(current => current === null ? null : { ...current, provider: modelProvider, model })}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('config.variants')}</span>
        <textarea
          className={css.input}
          value={configDraft.variantsText}
          placeholder={t('config.variantsPlaceholder')}
          onChange={event => setConfigDraft(current => current === null ? null : { ...current, variantsText: event.target.value })}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('config.defaultVariant')}</span>
        <Input
          value={configDraft.defaultVariant}
          className={css.inputWrap}
          onChange={event => setConfigDraft(current => current === null ? null : { ...current, defaultVariant: event.target.value })}
        />
      </label>
      <div className={css.editorActions}>
        <Button variant="primary" size="md" disabled={configSaving} onClick={() => { void saveConfig() }}>{configSaving ? '...' : t('config.save')}</Button>
        <Button variant="outline" size="md" disabled={configSaving} onClick={closeConfig}>{t('config.cancel')}</Button>
      </div>
    </div>
  )}
</div>
```

如果 `css.sectionBlock` / `css.sectionTitle` 不存在，在 `subagents.module.css` 中增加：

```css
.sectionBlock { margin-top: 24px; }
.sectionTitle { margin: 0; font-size: 16px; }
```

- [ ] **Step 8: 更新 `tests/section.client.spec.tsx`**

在 `catalogState` 中给 `deepseek-v4-flash-0731` 增加 reasoning 元数据：

```ts
{
  id: 'deepseek-v4-flash-0731',
  name: 'DeepSeek V4 Flash 0731',
  reasoning: { efforts: [{ id: 'high', name: 'high' }, { id: 'low', name: 'low' }], defaultEffort: 'high' },
},
```

在 `renderSection` 的 base 中新增：

```ts
createThinkingConfig: vi.fn(async () => {}),
updateThinkingConfig: vi.fn(async () => {}),
deleteThinkingConfig: vi.fn(async () => {}),
```

同时把所有 `renderSection` 的 `SubagentsSectionInjected` 使用处补上这三个方法（`mountSection` 传给组件 props）。

新增测试：

```ts
it('shows model-specific thinking variants and auto-selects the default on model change', async () => {
  const update = vi.fn(async () => {})
  const injected = renderSection({ update }, [customProfile])
  const { container, root } = mountSection(injected)
  try {
    const modelTrigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('jiyuan / deepseek-v4-flash-0731'))
    await act(async () => { modelTrigger?.click() })
    const secondModel = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('DeepSeek V4 0731'))
    await act(async () => { secondModel?.click() })
    expect(update).toHaveBeenCalledWith('custom-1', expect.objectContaining({ modelProvider: 'jiyuan', model: 'deepseek-v4-0731', reasoningEffort: null }))
  } finally {
    unmountSection(container, root)
  }
})

it('adds a thinking config from the management area', async () => {
  const create = vi.fn(async () => {})
  const injected = renderSection({ createThinkingConfig: create })
  const { container, root } = mountSection(injected)
  try {
    const addButton = [...container.querySelectorAll('button')].find(button => button.textContent === '新增配置')
    expect(addButton).toBeDefined()
    await act(async () => { addButton?.click() })
    const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent === '保存配置')
    expect(saveButton).toBeDefined()
    await act(async () => { saveButton?.click() })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ provider: '', model: '' }))
  } finally {
    unmountSection(container, root)
  }
})
```

如果已有测试依赖固定 `high` 选项，需要同步改为目录 reasoning 中的档位（上面 catalog 已包含 `high`）。

- [ ] **Step 9: 运行测试**

Run: `pnpm --dir dsh-subagents test tests/section.client.spec.tsx tests/controller.spec.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git -C dsh-subagents add src/client/SubagentsSection.tsx src/client/locales.ts src/client/subagents.module.css tests/section.client.spec.tsx
git -C dsh-subagents commit -m "feat(subagents): render per-model thinking variants and manage configs in settings"
```

---

### Task 8: README 文档

**Files:**
- Modify: `dsh-subagents/README.md`
- Modify: `dsh-subagents/README.zh.md`

- [ ] **Step 1: 在 README.zh.md 功能列表增加**

```markdown
- 每个模型可配置可用 Thinking Variant（`low/medium/high` 等）与默认档位；Subagents 和 composer 模型面板共用这套配置。
- 首次启动自动写入 `stepfun / step-3.7-flash` 的 `low/medium/high`（默认 `medium`）配置。
```

- [ ] **Step 2: 在 README.md 增加英文镜像**

```markdown
- Per-model Thinking Variant configuration (available efforts + default); shared by Subagents and the composer model picker.
- On first launch, `stepfun / step-3.7-flash` is seeded with `low/medium/high` (default `medium`).
```

- [ ] **Step 3: Commit**

```bash
git -C dsh-subagents add README.md README.zh.md
git -C dsh-subagents commit -m "docs(subagents): document thinking variant configuration"
```

---

### Task 9: Composer 拉取并合并手动配置

**Files:**
- Modify: `vendor/dsh-web-ui-62651870dd18ad3d9bf54a9cb934b75d0fbaf639/packages/dsh-remote-web-ui/src/mobile/api.ts`
- Modify: `vendor/dsh-web-ui-62651870dd18ad3d9bf54a9cb934b75d0fbaf639/packages/dsh-remote-web-ui/src/mobile/views/ChatView.tsx`
- Test: `vendor/.../packages/dsh-remote-web-ui/src/mobile/views/ChatView.test.tsx`

**Interfaces:**
- Produces: `listSubagentsThinkingConfigs(): Promise<ModelThinkingConfig[]>`; `ModelSheet` 合并逻辑。

- [ ] **Step 1: 在 `src/mobile/api.ts` 增加本地类型与函数**

```ts
export interface MobileThinkingVariant {
  id: string
  name: string
  description?: string
}

export interface MobileThinkingConfig {
  provider: string
  model: string
  variants: MobileThinkingVariant[]
  defaultVariant?: string
}

function isMobileThinkingConfig(value: unknown): value is MobileThinkingConfig {
  if (typeof value !== 'object' || value === null) return false
  const config = value as Partial<MobileThinkingConfig>
  if (typeof config.provider !== 'string' || config.provider === '') return false
  if (typeof config.model !== 'string' || config.model === '') return false
  if (!Array.isArray(config.variants) || config.variants.length === 0) return false
  const ids = new Set<string>()
  for (const variant of config.variants) {
    if (typeof variant !== 'object' || variant === null) return false
    if (typeof variant.id !== 'string' || variant.id === '' || typeof variant.name !== 'string' || variant.name === '') return false
    if (ids.has(variant.id)) return false
    ids.add(variant.id)
  }
  if (config.defaultVariant !== undefined && !ids.has(config.defaultVariant)) return false
  return true
}

export async function listSubagentsThinkingConfigs(): Promise<MobileThinkingConfig[]> {
  try {
    const value = await callUnary<{ configs?: unknown }>('dshSubagents.thinkingConfigs', {})
    return Array.isArray(value?.configs) ? value.configs.filter(isMobileThinkingConfig) : []
  } catch {
    return []
  }
}
```

- [ ] **Step 2: 修改 `ChatView.tsx` 的 ModelSheet 加载**

在 `models(sessionId)` 的 load 回调中改为同时加载：

```ts
Promise.all([models(sessionId), listSubagentsThinkingConfigs()]).then(
  ([data, configs]) => {
    const manualByKey = new Map(configs.map(config => [`${config.provider}\u0000${config.model}`, config]))
    const groups = data.groups.map(group => ({
      ...group,
      models: group.models.map(model => {
        const manual = manualByKey.get(`${group.id}\u0000${model.id}`)
        if (manual === undefined) return model
        return {
          ...model,
          reasoning: {
            efforts: manual.variants.map(variant => ({
              id: variant.id,
              name: variant.name,
              ...(variant.description === undefined ? {} : { description: variant.description }),
            })),
            ...(manual.defaultVariant === undefined ? {} : { defaultEffort: manual.defaultVariant }),
          },
        }
      }),
    }))
    setState({ status: 'ready', data: { ...data, groups } })
  },
  (reason: unknown) => { setState({ status: 'error', message: errorText(reason) }) },
)
```

- [ ] **Step 3: 更新 `ChatView.test.tsx`**

在 `vi.mock('../api.ts', ...)` 中增加：

```ts
listSubagentsThinkingConfigs: vi.fn(),
```

在 import 中增加：

```ts
import { listSubagentsThinkingConfigs, models, selectModel, sendCommand } from '../api.ts'
```

并声明：

```ts
const listSubagentsThinkingConfigsMock = vi.mocked(listSubagentsThinkingConfigs)
```

在 `beforeEach` 中设置默认值：

```ts
listSubagentsThinkingConfigsMock.mockResolvedValue([])
```

新增测试：

```ts
it('overrides catalog reasoning with dsh-subagents manual config in the model sheet', async () => {
  loadHistoryMock.mockResolvedValue(historyPage(turnEvents()))
  modelsMock.mockResolvedValue({
    current: { provider: 'stepfun', model: 'step-3.7-flash', reasoningEffort: 'medium' },
    routable: true,
    groups: [
      {
        id: 'stepfun',
        name: 'StepFun',
        models: [
          {
            id: 'step-3.7-flash',
            name: 'Step 3.7 Flash',
            reasoning: { efforts: [{ id: 'catalog-only', name: 'Catalog' }], defaultEffort: 'catalog-only' },
          },
        ],
      },
    ],
    failures: [],
  } satisfies SessionModels)
  listSubagentsThinkingConfigsMock.mockResolvedValue([
    {
      provider: 'stepfun',
      model: 'step-3.7-flash',
      variants: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }],
      defaultVariant: 'high',
    },
  ])
  render(<ChatView session={session} onBack={() => {}} />)

  fireEvent.click(await screen.findByRole('button', { name: /模型/ }))
  expect(await screen.findByRole('button', { name: /^低/ })).toBeTruthy()
  expect(await screen.findByRole('button', { name: /^高/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Catalog/ })).toBeNull()
})
```

- [ ] **Step 4: 运行 vendor 测试**

Run: `pnpm --dir vendor/dsh-web-ui-62651870dd18ad3d9bf54a9cb934b75d0fbaf639/packages/dsh-remote-web-ui test`
Expected: PASS

- [ ] **Step 5: 说明**

vendor 目录不是 git 仓库，本任务不产生独立 commit；改动随 dsh-subagents 后续 PR/补丁一并交付。

---

### Task 10: 全量验证与收尾

- [ ] **Step 1: 运行 dsh-subagents 全量测试与 typecheck**

Run: `pnpm --dir dsh-subagents test && pnpm --dir dsh-subagents typecheck`
Expected: PASS

- [ ] **Step 2: 运行 vendor remote-web-ui 相关测试**

Run: `pnpm --dir vendor/dsh-web-ui-62651870dd18ad3d9bf54a9cb934b75d0fbaf639/packages/dsh-remote-web-ui test`
Expected: PASS

- [ ] **Step 3: 更新 spec/plan 状态**

如实现过程中发现偏差，更新 `docs/superpowers/specs/2026-08-16-dsh-subagents-thinking-variants-design.md` 并提交。

```bash
git -C dsh-subagents add docs
git -C dsh-subagents commit -m "docs(subagents): update thinking variant spec after implementation"
```

- [ ] **Step 4: 最终 commit**

确保所有 dsh-subagents 改动已提交：

```bash
git -C dsh-subagents status --short
```
Expected: 无未提交改动（vendor 改动除外）。
