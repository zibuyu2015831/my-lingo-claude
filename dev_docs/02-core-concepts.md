# 核心概念设计

版本：v0.6

---

## 1. 语言空间（Language Space）

### 1.1 概念

语言空间是 My Lingo 的核心数据隔离单元。每个语言空间代表一种用户正在学习的目标语言，独立存储：

- 目标语言代码（`en` / `ja` / `de` / `fr` 等）
- 用户母语代码（用于解释说明）
- 学习等级（beginner / intermediate / advanced / A1-C2）
- 展示偏好（compact / full / off）
- 关联的 turns、学习材料、错误记录、课程

### 1.2 为什么需要独立语言空间

用户可能同时学习多门语言。混合存储会导致：
- 英语错误和日语错误混杂，无法生成针对性课程
- 不同语言的高频词汇难以区分
- 用户画像失真

### 1.3 配置文件格式

语言空间配置存储在 `$CLAUDE_PLUGIN_DATA/my-lingo/spaces.json`：

```json
{
  "active": "english",
  "spaces": {
    "english": {
      "key": "english",
      "display_name": "English",
      "target_language": "en",
      "native_language": "zh-CN",
      "level": "intermediate",
      "display_mode": "compact",
      "auto_generate_learning": true,
      "created_at": "2026-06-01T00:00:00Z"
    },
    "japanese": {
      "key": "japanese",
      "display_name": "Japanese",
      "target_language": "ja",
      "native_language": "zh-CN",
      "level": "beginner",
      "display_mode": "full",
      "auto_generate_learning": true,
      "created_at": "2026-06-05T00:00:00Z"
    }
  }
}
```

### 1.4 MVP 阶段限制

MVP（v0.1）只支持单个语言空间（English），多语言空间在 v0.2 实现。配置文件格式从一开始就支持多空间结构，保证升级兼容。

---

## 2. 执行模式（Execution Mode）

### 2.1 模式列表

| 模式 | 别名 | 含义 |
|------|------|------|
| `english_optimized` | `english` | 默认。优化为英文执行 Prompt，通过 additionalContext 注入 |
| `original` | `raw` | 不干预，只做记录和 SessionEnd 分析 |
| `original_with_english_context` | `mixed` | 保留原始输入，同时注入英文优化版作为参考 |
| `preview` | — | 在 systemMessage 展示优化结果，同时注入 Claude（不阻断流程）|
| `off` | — | 完全关闭，不处理、不记录 |

### 2.2 模式行为对比

```
english_optimized：
  原始输入 → 检测 → API 优化 → additionalContext（带"忽略原始语言"指令）
             ↓                   + systemMessage（展示给用户）
             → 记录 turn（original + execution_prompt）

original（raw）：
  原始输入 → 直接发给 Claude（不干预）
             → 记录 turn（original 只，无 execution_prompt）

mixed：
  原始输入 → API 优化 → additionalContext（英文版作为"English reference"）
             → 不发"忽略原始语言"指令（Claude 可参考两个版本）
             → 记录 turn

preview：
  原始输入 → API 优化 → systemMessage 展示优化结果
             → additionalContext 同时注入（与 english_optimized 一致）
             → 区别仅在于 systemMessage 格式更详细

off：
  原始输入 → 直接发给 Claude
             → 不记录任何内容
```

### 2.3 Hook 注入结构

`english_optimized` 模式的注入格式（见 `00-decisions.md` D1）：

```json
{
  "additionalContext": "CANONICAL REQUEST: The user's message is in {lang}. They configured My Lingo to optimize prompts to English. Treat the following as their actual request and ignore the language of their original message:\n\n{execution_prompt_en}",
  "systemMessage": "[my-lingo] {lang}→en ({latency}ms): {execution_prompt_en}\n{key_changes}"
}
```

---

## 3. 语言检测

### 3.1 本地检测算法

不调用外部 API，使用 ASCII 比率启发式算法（< 1ms）。**二分类**，无 mixed/cjk 中间态：

```javascript
// detect.mjs — ratio 为 0–100 整数；lang 只有 'en' / 'non-english'
function detectLanguage(text) {
  if (!text || text.trim().length === 0) return { lang: 'en', ratio: 100 }
  const chars = [...text]
  const asciiCount = chars.filter(c => {
    const code = c.charCodeAt(0)
    return code >= 0x20 && code <= 0x7e
  }).length
  const ratio = Math.round((asciiCount / chars.length) * 100)
  return {
    lang: ratio >= 85 ? 'en' : 'non-english',  // ≥85% ASCII 视为英文，否则一律 non-english
    ratio,
  }
}
```

> 凡 `non-english` 都照常走优化路径；不存在 `mixed`/`cjk`/`mode`/`confidence` 字段。优化时英文技术词由优化器 system prompt 负责保留。

### 3.2 跳过逻辑

`shouldSkip()` 命中以下情况直接跳过处理：
- `prompt.startsWith('/')` → slash 命令
- 字符数 `< 8` **且** 词数 `< 3` → 过短（CJK 无空格时用字符数兜底）
- 纯代码块（以 ` ``` ` 开头）
- URL / git / npm / docker 等命令前缀

> `!` 前缀**不在** `shouldSkip` 中：Claude Code 在 UI 层就把 `!foo` 当终端命令执行，消息根本不进 hook（见 [`13-raw-prefix-rename.md`](./13-raw-prefix-rename.md)）。

特殊前缀（在 `shouldSkip` 之前于 `user-prompt-submit.mjs` 分流）：
- `::` → 强制进入 refine 模式；**绕过 `shouldSkip`**，使 ":: fix" 等短输入也能处理
- `--` → 本次强制跳过优化，仅记录并透传（mode:'raw'）

---

## 4. Fallback 策略

### 4.1 触发条件

- 外部 API 调用超时（> timeout_seconds）
- API 返回错误（认证失败、rate limit 等）
- 网络不可达

### 4.2 策略选项

| 策略 | 行为 |
|------|------|
| `send_original` | 直接发原始输入，systemMessage 提示 API 不可用（推荐默认）|
| `skip` | 静默跳过优化，无提示 |
| `block` | 阻止 prompt，提示用户 API 不可用（不推荐，体验差）|

### 4.3 熔断机制

- 连续 3 次失败 → 自动切换为 `send_original`，写入 `circuit.json`
- 记录失败时间，下次请求检查是否恢复（默认 5 分钟后重试）
- 恢复成功后自动清除熔断状态

---

## 5. 配置层级

配置按以下优先级合并（高优先级覆盖低优先级，见 `config.mjs::loadConfig`）：

```
Layer 0（最高）：API 凭证（仅来自环境变量：CLAUDE_PLUGIN_OPTION_* > MY_LINGO_*）
  > Layer 1：项目级配置（.claude-my-lingo.json in cwd，凭证字段被过滤）
  > Layer 2：当前语言空间配置（spaces.json：target_language / native_language / display_mode / overrides）
  > Layer 3：全局配置（config.json，凭证字段被过滤）
  > Layer 4（最低）：插件内置默认值（DEFAULT_CONFIG）
```

> 凭证字段（`api_key` / `api_base_url` / `model_fast` / `model_deep`）属 `CREDENTIAL_FIELDS`：**只从环境变量读取，永不从/向文件读写**（见 [`12-env-var-config.md`](./12-env-var-config.md)）。

### 5.1 全局配置（config.json）

只存**偏好类**字段（凭证不落盘）。完整默认值见 `config.mjs::DEFAULT_CONFIG`：

```json
{
  "execution_mode": "english_optimized",
  "native_language": "zh-CN",
  "timeout_seconds": 8,
  "fallback_policy": "send_original",
  "privacy_mode": "standard",
  "max_prompt_length": 4000,
  "circuit_breaker_cooldown_minutes": 5,
  "display_mode": "full",
  "target_language": "en",
  "response_language_mode": "off",
  "summary_language_mode": "off",
  "deep_timeout_seconds": 55,
  "deep_max_tokens": 4096
}
```

### 5.2 项目级配置（.claude-my-lingo.json）

```json
{
  "execution_mode": "original",
  "domain_terms": ["MyApp", "UserService", "OrderRepo"]
}
```

---

## 6. Display Mode（展示模式）

控制 `systemMessage`（终端可见）的详细程度。当前 `buildSystemMessage` 实际只区分两态：

| 模式 | 含义 |
|------|------|
| `full` | systemMessage 显示完整 execution_prompt（**默认**，`DEFAULT_CONFIG.display_mode = 'full'`）|
| `compact` | systemMessage 截断到前 150 字符 |

> 历史文档曾列出 `off` / `execution_only` / `learning_only`，**均未实现**——任何非 `compact` 的值都按 `full` 处理。`display_mode` 可在全局 config.json 或语言空间字段设置。
>
> 注意：`systemMessage` 显示给用户，`additionalContext` 注入给 Claude，两者独立。

---

## 7. Response Language Mode（回复语言模式）

控制是否在 `additionalContext` 末尾追加指令，要求 Claude 以当前语言空间的目标语言回复。

| 模式 | 含义 |
|------|------|
| `off` | 不干预 Claude 回复语言（默认）|
| `target` | 追加 "Please respond entirely in {TargetLanguage}." 指令 |

目标语言由当前语言空间的 `target_language` 字段决定（如 `en` → English，`ja` → Japanese）。如果语言代码不在已知映射表内，指令静默忽略。

配置位置：`config.json`（全局）或语言空间的 `overrides`（单空间）。

与 `summary_language` 可共存：Claude 先以目标语言完整回复，再附上母语摘要。

---

## 8. Privacy Mode（隐私模式）

| 模式 | 行为 |
|------|------|
| `standard` | 出站前脱敏（`redactMessages`）；本地 `data.db` **始终存原文**（默认）|
| `off` | 不脱敏（适合使用本地 API 时）|

> `strict`（本地也脱敏）在历史文档中出现过，但**当前未实现**——除 `off` 外的任何值都按 `standard` 处理。脱敏覆盖：API keys、密码、用户名路径、私有 IP、连接字符串密码段、PEM 私钥、AWS key。详见 [`09-privacy-security.md`](./09-privacy-security.md)。
