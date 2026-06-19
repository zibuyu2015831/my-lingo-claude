# 外部 API 设计与 Prompt 协议

版本：v0.6

---

## 1. API 配置

My Lingo 使用 OpenAI-compatible API，支持任意兼容接口。

### 1.1 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `api_base_url` | API 基础 URL | 无（必填）|
| `api_key` | API 密钥 | 从 userConfig / 环境变量读取（不落盘）|
| `model_fast` | 同步路径使用的模型 | 无（必填）|
| `model_deep` | 异步分析使用的模型 | 同 model_fast |
| `timeout_seconds` | fast model API 超时（秒）| 8 |
| `deep_timeout_seconds` | deep model（分析/课程）超时（秒）| 55 |
| `deep_max_tokens` | deep model 输出预算 | 4096 |
| `circuit_breaker_cooldown_minutes` | 熔断冷却时长（分钟）| 5 |

> 同步路径不重试（无 `max_retries` 配置）；失败即按 `fallback_policy` 回退。

### 1.2 API Key 读取优先级

My Lingo 调用的是外部 API（OpenAI / DeepSeek / 其他），API key 由用户自行管理。凭证**绝不写入任何文件**（`config.mjs` 的 `CREDENTIAL_FIELDS` 在读写 config.json 时强制过滤），实际解析发生在 `loadConfig()` 的 Layer 0：

```javascript
// config.mjs Layer 0：plugin userConfig 优先，MY_LINGO_* 环境变量兜底
const cred = (optKey, envKey) => {
  const v = process.env[optKey]            // CLAUDE_PLUGIN_OPTION_*（userConfig 注入）
  if (v && v.trim()) return v
  const e = process.env[envKey]            // MY_LINGO_*（用户手动 export）
  if (e && e.trim()) return e
  return undefined
}
// → merged.api_key / api_base_url / model_fast / model_deep

// api.mjs 只读已解析好的 config
function getApiKey(config) {
  return config?.api_key ?? null
}
```

**API key 来源与优先级**：

| 优先级 | 来源 | 形态 | 写入时机 | 安全性 |
|------|------|------|---------|--------|
| 高 | plugin.json userConfig | Claude Code 注入为 `CLAUDE_PLUGIN_OPTION_API_KEY` 环境变量 | 插件安装界面填写 | `sensitive` 字段存系统 keychain |
| 低（兜底）| 环境变量 | `MY_LINGO_API_KEY` | 用户手动 export | 进程级隔离 |

**说明**：Claude Code 会把 plugin.json `userConfig` 的每个字段以 `CLAUDE_PLUGIN_OPTION_<字段大写>` 环境变量注入 hook 进程（`sensitive: true` 字段亦然，仅底层存储更安全）。因此运行时 hook 可直接读取 userConfig 值——无需也不会把 API key 落盘到 config.json。

**不**从 git 可见的明文文件读取 API key。

### 1.3 支持的 Provider

| Provider | api_base_url | 说明 |
|----------|-------------|------|
| OpenAI | `https://api.openai.com/v1` | 官方 |
| OpenRouter | `https://openrouter.ai/api/v1` | 聚合多模型 |
| DeepSeek | `https://api.deepseek.com/v1` | 低成本 |
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/v3` | 国内 |
| 本地（Ollama）| `http://localhost:11434/v1` | 隐私模式 |

---

## 2. 模型分层

### 2.1 Fast Model（同步路径）

用途：UserPromptSubmit hook 中生成 execution_prompt。

要求：
- **速度快**（P50 < 2s，P95 < 5s）
- **成本低**（每次 prompt 都调用，成本敏感）
- **JSON 输出稳定**（支持 `response_format: json_object`）
- **不过度发挥**（严格遵循指令，不添加不必要内容）

推荐模型：
- `gpt-4o-mini`
- `deepseek-chat`（DeepSeek V3，速度快、成本极低）
- `claude-haiku-4-5-20251001`

### 2.2 Deep Model（按需路径）

用途：`/my-lingo:lesson`、`/my-lingo:profile`、`/my-lingo:errors` 等命令的深度分析。

要求：
- **质量高**（分析细腻，课程内容有价值）
- **可接受较慢**（30-60s 可接受）
- **理解细微语言差异**

推荐模型：
- `gpt-4o`
- `deepseek-reasoner`（R1，深度分析场景）
- `claude-sonnet-4-6`

---

## 3. API 调用实现

### 3.1 核心调用函数

```javascript
// scripts/lib/api.mjs
import { spawnSync } from 'node:child_process'

export function callFastModel(payload, config) {
  const apiKey = getApiKey(config)
  if (!apiKey) {
    process.stderr.write('[my-lingo] No API key configured. Run /my-lingo:setup\n')
    return null
  }
  if (!config.api_base_url || !config.model_fast) return null

  const timeoutSec = config.timeout_seconds || 8
  // 唯一出站边界：发送前对整个 messages 统一脱敏（privacy.mjs，F2/D-A）
  const messages = redactMessages(payload.messages, config.privacy_mode)
  // 输出预算随输入规模动态放大（512–2048），避免固定 512 截断长 prompt 的 JSON（F7）
  const inputChars = messages.reduce(
    (s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
  const maxTokens = Math.min(2048, Math.max(512, Math.ceil(inputChars / 2) + 256))
  const body = JSON.stringify({
    model: config.model_fast,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages,
  })

  // 注意：不能在 hook 中使用 claude CLI（死锁），必须直接调用 curl
  const result = spawnSync('curl', [
    '-s',
    '--max-time', String(timeoutSec),
    `${config.api_base_url}/chat/completions`,
    '-H', 'content-type: application/json',
    '-H', `authorization: Bearer ${apiKey}`,
    '-d', body,
  ], {
    encoding: 'utf8',
    timeout: (timeoutSec + 2) * 1000  // spawnSync timeout > curl max-time
  })

  if (result.error || result.status !== 0) return null
  // parseModelResponse → extractJsonContent：容忍裸 JSON / ```json 代码围栏 / 前后散文三种形态
  return parseModelResponse(result.stdout)
}

// pending warning — drained on next emit()
let _pendingWarning = null

function handleApiError(error) {
  if (error.type === 'authentication_error') {
    _pendingWarning = '[my-lingo] Authentication failed. Check your API key with /my-lingo:setup.'
  }
}

// 调用方在 emit() 前调用此函数，将待播 warning 合并进 systemMessage
export function drainWarning(obj) {
  if (!_pendingWarning) return obj
  const msg = _pendingWarning
  _pendingWarning = null
  return { ...obj, systemMessage: obj.systemMessage ? `${msg}\n${obj.systemMessage}` : msg }
}
```

### 3.2 熔断检查

熔断器用于防止 API 连续失败时每次 prompt 都触发超时等待。**关键约束**：失败计数只跟踪"连续"失败；一次 API 成功必须重置计数。

```javascript
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from './storage.mjs'

const CIRCUIT_THRESHOLD = 3     // 连续失败 N 次后触发熔断
const COOLDOWN_MINUTES   = 5    // 熔断后冷却时间（分钟）

function circuitFile() {
  return path.join(getDataDir(), 'circuit.json')
}

// 检查是否处于熔断状态。返回 true 表示熔断中，应跳过 API 调用。
// 关键：冷却窗内仍需 failure_count >= 阈值 才算“开启”——单次瞬时失败只回退、不熔断。
export function checkCircuitBreaker(config) {
  const file = circuitFile()
  let circuit
  try {
    if (!fs.existsSync(file)) return false
    circuit = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  const cooldownMin = config?.circuit_breaker_cooldown_minutes ?? COOLDOWN_MINUTES
  const cooldownMs = cooldownMin * 60 * 1000
  if (Date.now() - (circuit.last_failure_at || 0) >= cooldownMs) {
    // 冷却期已过，无论累计多少次都自动重置
    try { fs.unlinkSync(file) } catch {}
    return false
  }
  // 冷却窗内：仅当累计失败达到阈值才开启
  return (circuit.failure_count || 0) >= CIRCUIT_THRESHOLD
}

// API 调用失败时调用。返回 true 表示本次失败触发了熔断。
export function recordApiFailure() {
  const file = circuitFile()
  
  let circuit = { failure_count: 0, last_failure_at: 0 }
  try {
    if (fs.existsSync(file)) {
      circuit = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  
  circuit.failure_count += 1
  circuit.last_failure_at = Date.now()
  
  try { fs.writeFileSync(file, JSON.stringify(circuit)) } catch {}
  
  return circuit.failure_count >= CIRCUIT_THRESHOLD
}

// API 调用成功时调用。重置连续失败计数（防止 "2失败→成功→1失败" 误触发熔断）。
export function recordApiSuccess() {
  const file = circuitFile()
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file) } catch {}
  }
}
```

**调用方式**（在 `callFastModel` 返回后）：

```javascript
const result = callFastModel(apiPayload, config)

if (!result) {
  const tripped = recordApiFailure()
  if (tripped) {
    emit({ systemMessage: '[my-lingo] Circuit breaker tripped — API paused for 5 min.' })
  }
  // fallback...
} else {
  recordApiSuccess()  // 成功后重置，确保连续失败计数清零
  // 正常路径...
}
```

---

## 4. Prompt 协议

### 4.1 执行 Prompt 优化（Fast Model）

#### System Prompt

> 以下为 `prompts.mjs` 中 `OPTIMIZATION_SYSTEM` 的真实文本（10 条规则，与 §5 一致）。

```
You are a prompt optimizer for Claude Code, a professional AI coding assistant.
Your job is to transform the user's input into an optimal English execution prompt.

Rules (strictly follow all):
1. Do not change the user's intent.
2. Do not add requirements that are not implied by the user.
3. Preserve code blocks, commands, logs, paths, identifiers, URLs, branch names, package names, and error messages.
4. Optimize the prompt for Claude Code usage.
5. Prefer clear task boundaries.
6. If the user asks for analysis, do not turn it into implementation.
7. If the user asks to implement, preserve that intent.
8. If the original prompt is ambiguous, add only minimal clarification.
9. Output valid JSON only.
10. Never expose secrets or sensitive values in generated content.

Additional domain terms to preserve: {domain_terms}

Output JSON with fields: detected_input_language, execution_prompt_en, rewrite_type, key_changes
```

#### User Message

```
Input language: {detected_language}
User's prompt: {original_prompt}

Generate the optimized English execution prompt.
```

#### 输出格式（JSON）

```json
{
  "detected_input_language": "zh-CN",
  "execution_prompt_en": "Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks.",
  "rewrite_type": "translate_and_optimize",
  "key_changes": [
    "Translated from Chinese",
    "Added explicit boundary: do not modify files",
    "Added analysis structure"
  ]
}
```

`rewrite_type` 可选值：
- `translate` — 纯翻译，无结构改变
- `translate_and_optimize` — 翻译 + Prompt 优化
- `correct` — 纯英文但有语法/表达问题
- `optimize` — 英文无明显错误但 Prompt 结构可改善
- `passthrough` — 无需改变（高质量英文 Prompt）

---

### 4.2 学习文本生成（Deep Model，SessionEnd / 按需）

#### System Prompt

```
You are a language learning assistant for a developer learning {target_language}.
The developer's native language is {native_language}.

Analyze the difference between the user's original prompt and the optimized version.
Generate learning content that helps them improve their {target_language} expression
in technical, AI-coding contexts.

Rules:
1. Only flag REAL language errors, not stylistic preferences.
2. NEVER flag technical terms (code, variable names, tool names, error messages) as errors.
3. Explain errors in the user's native language ({native_language}).
4. Focus on patterns the user can remember and reuse.
5. Be conservative — 3 corrections maximum, pick the most valuable ones.
6. Output valid JSON only.
```

#### 输出格式（JSON）

```json
{
  "target_language": "en",
  "corrections": [
    {
      "type": "grammar",
      "original": "this code have bug",
      "corrected": "this code has a bug",
      "explanation": "单数名词 code 搭配 has，不用 have；bug 前加 a",
      "pattern": "subject-verb agreement"
    }
  ],
  "learning_points": [
    {
      "type": "phrase",
      "target_text": "identify potential bugs",
      "native_explanation": "找出潜在的问题/bug"
    },
    {
      "type": "sentence_pattern",
      "target_text": "Review X and identify Y",
      "native_explanation": "检查X并找出Y，Claude Code 中常用的分析类 Prompt 结构"
    }
  ]
}
```

---

### 4.3 课程生成（Deep Model，按需）

仅在用户执行 `/my-lingo:lesson` 时调用。

#### System Prompt

```
You are a language teacher for a developer learning {target_language}.
Native language: {native_language}.
Learning level: {level}.
Focus: technical English used in AI-coding workflows.

Based on the provided learning history (turns, corrections, patterns),
generate a personalized lesson. The lesson should:
1. Focus on the user's actual mistakes and patterns from their real work
2. Use examples directly from their coding sessions
3. Be practical and immediately applicable
4. Not exceed 500 words
5. Follow the lesson structure below
```

#### 课程 Markdown 结构

```markdown
# My Lingo Lesson — {date}

## Summary
{1-2 sentence overview of this lesson's focus}

## Common Errors This Period
### {Error Pattern Name}
- Your expression: `{original}`
- Better: `{corrected}`
- Pattern: `{abstract_pattern}`

## Key Expressions to Remember
1. **{expression}** — {native_explanation}
   Example: `{example_sentence}`

## Prompt Patterns
{Coding-specific prompt patterns the user should adopt}

## Next Focus
{1-2 things to work on next session}
```

---

## 5. Prompt 优化规则（必须写入 System Prompt）

这 10 条规则是 Prompt 优化的硬约束，必须始终包含在 System Prompt 中：

1. Do not change the user's intent.
2. Do not add requirements that are not implied by the user.
3. Preserve code blocks, commands, logs, paths, identifiers, URLs, branch names, package names, and error messages.
4. Optimize the prompt for Claude Code usage.
5. Prefer clear task boundaries.
6. If the user asks for analysis, do not turn it into implementation.
7. If the user asks to implement, preserve that intent.
8. If the original prompt is ambiguous, add only minimal clarification.
9. Output valid JSON only.
10. Never expose secrets or sensitive values in generated content.
