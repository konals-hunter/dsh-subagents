# dsh-subagents 每模型 Thinking Variant 配置设计

- 日期：2026-08-16
- 状态：待用户 review
- 包名：@konals/dsh-subagents；插件 id：dsh-subagents
- 关联：`vendor/dsh-web-ui-62651870dd18ad3d9bf54a9cb934b75d0fbaf639/packages/dsh-remote-web-ui` 的 composer 模型选择面板

## 1. 背景与目标

DSH 模型目录（`llm.models`）已经通过 `model.reasoning.efforts` / `model.reasoning.defaultEffort`
暴露每个模型实际支持的 Thinking Variant。composer 的模型/思考强度面板已经在使用这份元数据，
但 dsh-subagents 目前把 Thinking Variant 下拉写死为 `off/low/medium/high/max`，没有读取模型目录，
也无法让用户自定义某个模型的可用档位。

目标：

1. 在 dsh-subagents 中新增“每个模型可用 Thinking Variant”的手动配置。
2. 有效配置规则：手动配置优先，其次 DSH 模型目录元数据，都没有则只显示“跟随模型默认”。
3. Subagents 页面与 composer 模型选择面板使用同一套有效配置。
4. 切换模型时自动应用该模型默认 Thinking Variant（与 composer 行为一致）。
5. 首次启动自动写入 `stepfun / step-3.7-flash` 的默认配置：`low` / `medium` / `high`，默认 `medium`。
6. 不修改 DSH harness 核心源码。

## 2. 范围

### 2.1 范围内

- dsh-subagents：
  - `ReasoningEffort` 从固定枚举改为任意非空字符串。
  - 新增 `ModelThinkingVariant` / `ModelThinkingConfig` 数据模型。
  - 存储文件增加 `modelThinkingConfigs` 可选字段，保持 `FORMAT_VERSION = 1`。
  - 新增 REST CRUD：`/api/dsh-subagents/thinking-configs`。
  - Settings 页面新增“模型 Thinking Variant 配置”管理区。
  - Profile 卡片/表单的 `EffortSelect` 按当前 `(provider, model)` 的有效配置动态生成。
  - 切换模型时自动设置 `reasoningEffort` 为默认档位，或清空为“跟随模型默认”。
  - 首次启动（文件不存在或 `modelThinkingConfigs` 字段缺失）自动写入 step-3.7-flash 默认配置。
- vendor `dsh-remote-web-ui`：
  - composer `ModelSheet` 通过 vendor 的 `/m/api` 白名单方法 `dshSubagents.thinkingConfigs` 读取 dsh-subagents host 服务提供的手动配置，并合并到模型目录元数据。
  - 拉取失败或 dsh-subagents 未安装时静默降级，composer 维持现状。

### 2.2 范围外

- 不修改 DSH harness 核心源码。
- 不做每个 profile 独立覆盖；配置是“provider + model”级别的全局配置。
- 不做已有 profile `reasoningEffort` 的自动迁移/重命名。
- 不在 host 层给 `llm.models` 注入数据。

## 3. 数据模型

### 3.1 protocol.ts

```ts
/** Adapter 的 opaque thinking variant id；undefined 表示跟随模型默认。 */
export type ReasoningEffort = string

export interface ModelThinkingVariant {
  /** 提交给 adapter 的值，如 low / medium / high / deep */
  id: string
  /** 下拉显示名 */
  name: string
  /** 可选说明 */
  description?: string
}

export interface ModelThinkingConfig {
  provider: string
  model: string
  /** 至少 1 项，且 id 不能重复 */
  variants: ModelThinkingVariant[]
  /** 可选；若提供必须属于 variants */
  defaultVariant?: string
}
```

### 3.2 存储文件（~/.dsh/dsh-subagents.json）

```json
{
  "version": 1,
  "profiles": [],
  "modelThinkingConfigs": [
    {
      "provider": "stepfun",
      "model": "step-3.7-flash",
      "variants": [
        { "id": "low", "name": "low" },
        { "id": "medium", "name": "medium" },
        { "id": "high", "name": "high" }
      ],
      "defaultVariant": "medium"
    }
  ]
}
```

- `FORMAT_VERSION` 保持 `1`；`modelThinkingConfigs` 是可选字段。
- 新文件或旧文件缺少该字段时自动写入上述默认配置；字段已存在（包括 `[]`）时尊重用户当前状态，避免删除后又被重新 seed。

## 4. 有效配置合并

新增纯函数模块 `src/thinking.ts`（client/host 共用类型，逻辑放在 client 侧使用）。

```ts
interface EffectiveReasoning {
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

function getEffectiveReasoning(
  provider: string,
  model: string,
  manualConfigs: ModelThinkingConfig[],
  catalogGroups: readonly ModelProviderGroup[],
): EffectiveReasoning | undefined
```

合并规则：

1. 先查 `manualConfigs` 中 `provider + model` 精确匹配的条目。
2. 未命中则查目录 `catalogGroups` 中 `model.reasoning`。
3. 都未命中返回 `undefined`。

下拉选项构建：

- 始终包含 `{ value: null, label: t('form.reasoningEffort.none') }`。
- 有有效配置时追加 `efforts.map(e => ({ value: e.id, label: e.name }))`。
- 没有有效配置时只保留“跟随模型默认”，不再显示固定档位。

默认档位解析：

- 手动配置 `defaultVariant` 优先。
- 否则使用目录 `defaultEffort`。
- 都没有则 `undefined`，即“跟随模型默认”。

## 5. REST API

在 `SUBAGENTS_API` 增加：

```ts
thinkingConfigs: '/api/dsh-subagents/thinking-configs'
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dsh-subagents/thinking-configs` | 返回 `{ configs: ModelThinkingConfig[] }` |
| POST | `/api/dsh-subagents/thinking-configs` | 新增；`(provider, model)` 唯一 |
| PUT | `/api/dsh-subagents/thinking-configs?provider=..&model=..` | 更新 `variants` / `defaultVariant`；provider/model 不可改 |
| DELETE | `/api/dsh-subagents/thinking-configs?provider=..&model=..` | 删除 |

复用现有 loopback-only 防护。错误语义与现有 profile 路由一致：非法请求返回 400 + `{ error }`，存储失败返回 500。

校验规则：

- `provider` / `model` 非空字符串且 trim 后非空。
- `variants` 必须是数组且至少 1 项。
- 每项 `id` / `name` 非空字符串。
- `variants` 内 `id` 不能重复。
- `defaultVariant` 可选；提供时必须属于 `variants` 的某个 `id`。
- POST 时 `(provider, model)` 已存在则返回 400。

## 6. Subagents Settings 页面

### 6.1 状态与 API

- `SubagentsSectionState` 增加 `thinkingConfigs: ModelThinkingConfig[]`。
- `SubagentsSectionController.load()` 同时加载 profiles 与 thinking configs。
- 新增 `createThinkingConfig` / `updateThinkingConfig` / `deleteThinkingConfig` 动作。
- `SubagentsApi` 增加对应方法。

### 6.2 管理区

在 profiles 列表下方新增“模型 Thinking Variant 配置”区块：

- 列表展示 `provider / model`、variants、默认档位。
- 支持新增、编辑、删除。
- v1 编辑表单：
  - `ModelSelect` 选择 provider/model；
  - textarea 输入 variants，每行 `id=显示名`，可选描述 `id=显示名|描述`；
  - 文本框输入默认 variant id，留空表示“跟随模型默认”。

### 6.3 Profile 的 Thinking Variant 下拉

- 列表卡片和编辑表单中的 `EffortSelect` 选项由 `getEffectiveReasoning(profile.modelProvider, profile.model, thinkingConfigs, catalog.groups)` 生成。
- 切换模型时：
  - 新模型有有效默认档位 → `setDraft` / `update` 同时写入该档位。
  - 没有 → 清空为 `null`（跟随模型默认）。
- 当前 `reasoningEffort` 不在可用选项内时，下拉仍显示原值；用户可手动选择“跟随模型默认”清除。

## 7. Composer（vendor dsh-remote-web-ui）

### 7.1 API

在 `src/mobile/api.ts` 增加：

```ts
export async function listSubagentsThinkingConfigs(): Promise<ModelThinkingConfig[]>
```

- 通过 mobile 包自己的 `callUnary('dshSubagents.thinkingConfigs', {})` 请求 vendor `/m/api` 白名单通道，而不是直接访问 loopback-only 的 `/api/dsh-subagents/*`。
- vendor host 半区在 `dispatch` 中调用 dsh-subagents host 服务 `ctx.get('dsh-subagents').listThinkingConfigs()`（延迟解析，避免插件加载顺序问题）。
- 非 2xx、RPC/网络错误或畸形响应时返回 `[]`，不抛错；畸形 config 条目会被过滤。
- 类型在 mobile 包内本地定义，避免跨包 value import。

### 7.2 ModelSheet 合并

- 加载模型目录时并行请求 `models(sessionId)` 与 `listSubagentsThinkingConfigs()`。
- 对每个 `(provider, model)`：
  - 有手动配置 → 用 `{ efforts, defaultEffort }` 覆盖 `model.reasoning`；
  - 没有 → 保留目录 `model.reasoning`。
- 现有“选择模型自动带默认档位”“思考强度列表”逻辑保持不变。
- dsh-subagents 未安装或接口失败时静默降级为现状。

## 8. 错误处理

- 配置管理区表单错误显示在区块顶部，与 profile 表单一致。
- 存储文件含非法 `modelThinkingConfigs` 时按现有 corrupt 语义处理：拒绝覆盖用户文件，页面显示损坏提示。
- composer 拉取配置失败不阻断聊天、不显示错误。

## 9. 测试

### 9.1 dsh-subagents

- `tests/thinking.spec.ts`：
  - 手动配置优先于目录；
  - 目录兜底；
  - 都没有时只返回默认项；
  - 默认档位解析。
- `tests/store.spec.ts`：
  - `ReasoningEffort` 接受任意非空字符串；
  - `modelThinkingConfigs` CRUD、唯一性、校验；
  - seed 逻辑：新文件/缺字段自动写入 step-3.7-flash；已存在 `[]` 不重写。
- `tests/routes.spec.ts`：
  - thinking-configs GET/POST/PUT/DELETE；
  - 非法 body 400；
  - loopback 防护。
- `tests/controller.spec.ts`：新增配置动作与状态更新。
- `tests/section.client.spec.tsx`：
  - 管理区渲染与 CRUD；
  - 动态 variants 下拉；
  - 切换模型自动设置默认档位。

### 9.2 vendor dsh-remote-web-ui

- `ChatView.test.tsx`：
  - 手动配置覆盖目录元数据；
  - composer 显示手动 variants 与默认档位；
  - 拉取失败时保持原目录行为。

## 10. 文档

- 更新 `dsh-subagents/README.md` 与 `README.zh.md`：
  - 新增“模型 Thinking Variant 配置”说明；
  - 合并优先级；
  - step-3.7-flash 默认 seed；
  - composer 同步说明。
- 如 vendor 包 README 描述模型选择器行为，补充一行 composer 会读取 dsh-subagents 手动配置。

## 11. 验收标准

1. 首次启动后 `~/.dsh/dsh-subagents.json` 自动包含 `stepfun / step-3.7-flash` 配置，Settings 中可见可编辑。
2. Subagents 中为某 profile 选择模型后，Thinking Variant 下拉只显示该模型有效档位。
3. 切换模型时自动设置默认档位；无默认档位时清空为“跟随模型默认”。
4. composer 模型/思考强度面板能看到 dsh-subagents 手动配置覆盖的 variants。
5. dsh-subagents 未安装时 composer 行为不变。
6. 所有新路由仅 loopback 可访问。
