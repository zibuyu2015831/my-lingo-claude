# 核心概念设计

版本：v0.2

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

不调用外部 API，使用 ASCII 比率启发式算法（< 1ms）：

```javascript
function detectLanguage(text) {
  const chars = [...text]
  let asciiCount = 0
  for (const ch of chars) {
    const code = ch.charCodeAt(0)
    if (code >= 0x20 && code <= 0x7E) asciiCount++
  }
  const ratio = asciiCount / chars.length

  if (ratio >= 0.85) return { lang: 'en', mode: 'correct' }   // 英文为主
  if (ratio <= 0.30) return { lang: 'cjk', mode: 'translate' } // CJK 为主
  return { lang: 'mixed', mode: 'translate' }                   // 混合（中英夹杂）
}
```

### 3.2 跳过逻辑

以下情况直接跳过处理：
- `prompt.startsWith('/')` → slash 命令
- `prompt.startsWith('!')` → shell 命令
- `[...prompt].length < 8` → 过短
- 纯代码块（以 ` ``` ` 开头）
- URL / git / npm / docker 等命令前缀

特殊前缀：
- `::` → 强制进入 refine 模式（无论 auto_correct 设置如何）
- `--` → 本次强制跳过优化

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

配置按以下优先级合并（高优先级覆盖低优先级）：

```
本次输入 inline override（如 -- 前缀）
  > 项目级配置（.claude-my-lingo.json in cwd）
  > 当前语言空间配置（spaces.json 中对应 space）
  > 全局配置（config.json）
  > 插件默认值
```

### 5.1 全局配置（config.json）

```json
{
  "api_base_url": "https://api.openai.com/v1",
  "model_fast": "gpt-4o-mini",
  "model_deep": "gpt-4o",
  "timeout_seconds": 8,
  "fallback_policy": "send_original",
  "execution_mode": "english_optimized",
  "native_language": "zh-CN",
  "default_target_language": "en",
  "privacy_mode": "standard",
  "max_prompt_length": 4000
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

每个语言空间有独立展示模式配置：

| 模式 | 含义 |
|------|------|
| `off` | 不展示任何学习内容 |
| `compact` | systemMessage 显示简短优化结果 + 1-2 个关键学习点（默认）|
| `full` | systemMessage 显示完整的 original / execution_prompt / learning_text |
| `execution_only` | 只展示执行 Prompt，不展示学习内容 |
| `learning_only` | 只展示学习文本，不展示执行 Prompt |

注意：`systemMessage` 是在 Claude Code 终端界面显示给用户的内容，`additionalContext` 是注入给 Claude 的内容，两者独立配置。

---

## 7. Privacy Mode（隐私模式）

| 模式 | 行为 |
|------|------|
| `standard` | 脱敏后发给外部 API，本地 JSONL 存原始内容 |
| `strict` | 脱敏后发给外部 API，本地 JSONL 也只存脱敏内容 |
| `off` | 不脱敏（适合使用本地 API 时）|

脱敏覆盖范围：API keys、密码、用户名路径、私有 IP、连接字符串中的密码段。详见 `09-privacy-security.md`。
