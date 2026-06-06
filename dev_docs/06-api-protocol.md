# 外部 API 设计与 Prompt 协议

版本：v0.2

---

## 1. API 配置

My Lingo 使用 OpenAI-compatible API，支持任意兼容接口。

### 1.1 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `api_base_url` | API 基础 URL | 无（必填）|
| `api_key` | API 密钥 | 从环境变量读取 |
| `model_fast` | 同步路径使用的模型 | 无（必填）|
| `model_deep` | 异步分析使用的模型 | 同 model_fast |
| `timeout_seconds` | API 超时（秒）| 8 |
| `max_retries` | 最大重试次数（同步路径不重试）| 0 |

### 1.2 API Key 读取优先级

```javascript
function getApiKey(config) {
  // 1. 环境变量（最高优先级）
  if (process.env.MY_LINGO_API_KEY) return process.env.MY_LINGO_API_KEY
  
  // 2. Claude Code userConfig（plugin.json 中声明，Claude Code 加密存储）
  if (config.api_key) return config.api_key
  
  return null
}
```

**不**从磁盘上的明文文件读取 API key。

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
  const body = JSON.stringify({
    model: config.model_fast,
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: payload.messages
  })
  
  const timeoutSec = config.timeout_seconds || 8
  const apiKey = getApiKey(config)
  
  if (!apiKey) {
    console.error('[my-lingo] No API key configured. Run /my-lingo:setup')
    return null
  }
  
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
  
  try {
    const response = JSON.parse(result.stdout)
    if (response.error) {
      handleApiError(response.error, config)
      return null
    }
    const content = response.choices?.[0]?.message?.content
    return content ? JSON.parse(content) : null
  } catch {
    return null
  }
}

function handleApiError(error, config) {
  if (error.type === 'authentication_error') {
    // 下次 hook 调用时会通过 systemMessage 展示
    process.env._MY_LINGO_AUTH_ERROR = '1'
  }
}
```

### 3.2 熔断检查

```javascript
export function checkCircuitBreaker(config) {
  const circuitFile = path.join(getDataDir(), 'circuit.json')
  if (!fs.existsSync(circuitFile)) return false  // 熔断器未触发
  
  const circuit = JSON.parse(fs.readFileSync(circuitFile, 'utf8'))
  const cooldownMs = (config.circuit_breaker_cooldown_minutes || 5) * 60 * 1000
  
  if (Date.now() - circuit.last_failure_at < cooldownMs) {
    return true  // 熔断中，跳过 API 调用
  }
  
  // 冷却期过，重置熔断器
  fs.unlinkSync(circuitFile)
  return false
}

export function recordApiFailure(config) {
  const circuitFile = path.join(getDataDir(), 'circuit.json')
  
  let circuit = { failure_count: 0, last_failure_at: 0 }
  if (fs.existsSync(circuitFile)) {
    circuit = JSON.parse(fs.readFileSync(circuitFile, 'utf8'))
  }
  
  circuit.failure_count += 1
  circuit.last_failure_at = Date.now()
  
  fs.writeFileSync(circuitFile, JSON.stringify(circuit))
  
  // 连续 3 次失败，触发熔断
  return circuit.failure_count >= 3
}
```

---

## 4. Prompt 协议

### 4.1 执行 Prompt 优化（Fast Model）

#### System Prompt

```
You are a prompt optimizer for Claude Code, a professional AI coding assistant.
Your job is to transform the user's input into an optimal English execution prompt.

Rules (strictly follow all):
1. NEVER change the user's intent.
2. NEVER add requirements not implied by the user.
3. PRESERVE code blocks, commands, file paths, variable names, package names, 
   error messages, URLs, branch names, and all technical identifiers exactly as-is.
4. OPTIMIZE for Claude Code: use imperative mood, specify boundaries clearly,
   add structure for complex tasks, clarify analysis vs. implementation intent.
5. If the user asks for analysis only, do NOT turn it into implementation.
6. If the user asks to implement, preserve that intent exactly.
7. If ambiguous, add MINIMAL clarification only.
8. OUTPUT valid JSON only. No explanation. No markdown.

Additional domain terms to preserve: {domain_terms}
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
