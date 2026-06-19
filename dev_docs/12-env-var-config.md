# 环境变量配置迁移方案

版本：v0.3 — 2026-06-08

---

## 1. 背景与问题

当前 `/my-lingo:setup` 向导通过对话交互收集 API Key，导致密钥明文出现在：
- Claude 对话记录（本地 transcript 文件）
- 可能同步到 Anthropic 服务器的上下文

这是一个安全风险。API Key 属于凭证类数据，不应经过任何对话上下文。

---

## 2. 解决方案：API 凭证改用环境变量

### 2.1 设计原则

- **凭证类**字段（API Key、API URL、模型名）改为从环境变量读取，不再写入 config.json
- **偏好类**字段（execution_mode、native_language 等）保留在 config.json
- 环境变量作为最高优先级覆盖层（Layer 0），高于文件配置
- `/setup` 命令不再收集任何凭证信息，只负责检查和验证

### 2.2 凭证来源定义（plugin userConfig 优先，环境变量兜底）

| 对应字段 | 优先：plugin userConfig（注入形式）| 兜底：环境变量 | 是否必填 | 示例值 |
|---------|---------|---------|---------|-------|
| `api_key` | `CLAUDE_PLUGIN_OPTION_API_KEY` | `MY_LINGO_API_KEY` | 必填 | `sk-...` |
| `api_base_url` | `CLAUDE_PLUGIN_OPTION_API_BASE_URL` | `MY_LINGO_API_BASE_URL` | 必填 | `https://api.openai.com/v1` |
| `model_fast` | `CLAUDE_PLUGIN_OPTION_MODEL_FAST` | `MY_LINGO_MODEL_FAST` | 必填 | `gpt-4o-mini` |
| `model_deep` | `CLAUDE_PLUGIN_OPTION_MODEL_DEEP` | `MY_LINGO_MODEL_DEEP` | 选填 | `gpt-4o`（默认等于 model_fast） |

注意：`api.mjs` 的 `getApiKey()` 只读 `config.api_key`；凭证解析统一在 `loadConfig()` 的 Layer 0（`credValue()`）完成。

### 2.3 配置优先级（修改后）

```
Layer 0 (最高): 凭证（plugin userConfig CLAUDE_PLUGIN_OPTION_* > 环境变量 MY_LINGO_*）
Layer 1:        项目级配置 .claude-my-lingo.json
Layer 2:        语言空间 overrides（spaces.json）
Layer 3:        全局配置 config.json（不再存储凭证字段）
Layer 4 (最低): 代码内置默认值
```

---

## 3. 改动范围

### 3.1 `scripts/lib/config.mjs`（核心改动）

在 `loadConfig()` 末尾添加 Layer 0 覆盖：

```js
// Layer 0 (最高): 凭证 —— plugin userConfig 优先，MY_LINGO_* 环境变量兜底
const cred = (optKey, envKey) => {
  const v = process.env[optKey]            // CLAUDE_PLUGIN_OPTION_*（userConfig 注入）
  if (v && v.trim()) return v
  const e = process.env[envKey]            // MY_LINGO_*（用户手动 export）
  if (e && e.trim()) return e
  return undefined
}
const api_key      = cred('CLAUDE_PLUGIN_OPTION_API_KEY',      'MY_LINGO_API_KEY')
const api_base_url = cred('CLAUDE_PLUGIN_OPTION_API_BASE_URL', 'MY_LINGO_API_BASE_URL')
const model_fast   = cred('CLAUDE_PLUGIN_OPTION_MODEL_FAST',   'MY_LINGO_MODEL_FAST')
const model_deep   = cred('CLAUDE_PLUGIN_OPTION_MODEL_DEEP',   'MY_LINGO_MODEL_DEEP')
if (api_key)      merged.api_key      = api_key
if (api_base_url) merged.api_base_url = api_base_url
if (model_fast)   merged.model_fast   = model_fast
if (model_deep)   merged.model_deep   = model_deep
```

`writeConfig()` 修改：写入前删除 `api_key`、`api_base_url`、`model_fast`、`model_deep`，防止凭证被持久化到文件：

```js
export function writeConfig(config) {
  const { api_key, api_base_url, model_fast, model_deep, ...safeConfig } = config
  // 写入 safeConfig，凭证字段不落地
}
```

同时删除 `DEFAULT_CONFIG` 中不应有默认值的字段（这几个字段本来就没有默认值，已经符合）。

### 3.2 `commands/my-lingo/setup.md`（重写）

新流程：
1. **检查环境变量** — 列出 4 个变量的当前状态（已设置 / 未设置，Key 只显示末 4 位）
2. **若有未设置的变量** — 打印各平台配置说明，告知用户按平台自行设置后重新运行
3. **若全部已设置** — 运行 API 连通性测试
4. **初始化 spaces.json**（若不存在）
5. **显示最终状态摘要**

不再有任何"请输入 API Key"的交互步骤。

### 3.3 `commands/my-lingo/info.md`（调整；命令早期叫 `status`，已重命名为 `info`）

- 移除"config.json 不存在则退出"的前置检查（凭证改走环境变量后，config.json 可能不存在）
- 显示 API 配置来源标注：优先 `CLAUDE_PLUGIN_OPTION_*`，回退 `MY_LINGO_*`，再否则"未设置"
- 若凭证未配置，提示运行 `/my-lingo:setup`

### 3.4 `dev_docs/07-storage.md`（文档更新）

- 更新 4.1 节 config.json 示例，删除 `api_key` 字段
- 更新注释，说明凭证字段改由环境变量提供
- 补充环境变量表格

### 3.5 `README.md` 和 `README.zh.md`（文档更新）

在 Quick Start / 快速开始章节，增加环境变量配置说明，提供各平台示例：
- macOS/Linux：`export` 写入 `~/.zshrc` 或 `~/.bashrc`
- Windows：系统属性 → 环境变量 GUI

---

## 4. 无向后兼容负担

项目未发布，采用最简设计：

- `loadConfig()` 在所有文件层（Layer 1、Layer 3）读取时主动过滤掉凭证字段，文件中即使存在这些字段也被完全忽略
- `writeConfig()` 写入前同样过滤，凭证字段永远不落地
- `getApiKey(config)` 直接返回 `config.api_key`，无冗余的 env var 二次检查（`loadConfig` 已在 Layer 0 统一处理）
- 凭证的合法来源：**plugin.json userConfig（注入为 `CLAUDE_PLUGIN_OPTION_*`）优先，`MY_LINGO_*` 环境变量兜底**（与 §2.2 一致）；**绝不来自文件**

---

## 5. 不在本次范围内

- `mode.md` 读写 `execution_mode` 到 config.json — 不变（非凭证字段）
- `spaces.json` 相关命令 — 不变
- `analysis.mjs` / `generate-lesson.mjs` — 无需改动，通过 `loadConfig()` 自动获得环境变量值

---

## 6. 实施顺序

1. `scripts/lib/config.mjs` — 添加 Layer 0，修改 writeConfig
2. `commands/my-lingo/setup.md` — 重写
3. `commands/my-lingo/info.md`（原 `status.md`）— 调整
4. `dev_docs/07-storage.md` — 更新
5. `README.md` + `README.zh.md` — 添加环境变量章节
