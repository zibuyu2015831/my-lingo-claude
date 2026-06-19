# 隐私与安全设计

版本：v0.6

---

## 1. 威胁模型

My Lingo 在用户本机运行，通过外部 API 处理用户 prompt。主要隐私风险：

1. **外部 API 接收敏感内容**：用户的 prompt 可能包含 API key、密码、内部主机名、私有代码等。注意：自 v0.4 起，**Claude 的回复也会在 SessionEnd 学习分析与课程生成时发往外部 deep model**（见 §4.1）
2. **本地 SQLite 库包含明文**：历史 prompt 原文存储在 `data.db`（`turns.original_prompt` 未脱敏），可能被其他进程读取
3. **跨项目数据混合**：公开项目和私有项目的 prompt 存在同一个数据库中
4. **Hook 脚本权限**：hook 以当前用户权限运行，需防止路径穿越等攻击

---

## 2. 脱敏策略

### 2.1 脱敏时机（集中在出站边界）

脱敏由 `redactMessages()` 在**唯一出站边界**执行——`api.mjs::callFastModel` 与 `analysis.mjs::callDeepModel` 在 `spawnSync('curl')` 之前对整个 `messages` payload 统一脱敏（v0.5 架构审查 F2/D-A 的修复）。这样 SessionEnd 分析、`/my-lingo:lesson` 等**所有从 DB 读回原文再外发的路径都默认受保护**。

| 阶段 | `standard`（默认） | `off` |
|------|-------------------|-------|
| 发送给外部 API 前 | ✅ 脱敏（`redactMessages`） | ❌ 不脱敏 |
| 写入本地 `data.db` | ❌ 始终存原文 | ❌ 始终存原文 |

> ⚠️ **本地始终存原文**：`privacy_mode` 只控制**出站**是否脱敏；`storage.writeTurn` 写入 `turns.original_prompt` 永远是未脱敏原文（用户有权查看自己的输入）。当前实现**没有"本地也脱敏"的 `strict` 模式**——`redact()` 只识别 `privacy_mode === 'off'` 来整体跳过，其余值（含历史文档提到的 `strict`）都按 `standard` 处理。若未来需要本地脱敏，需新增分支并在 `writeTurn` 落库前调用。

### 2.2 脱敏规则

```javascript
// scripts/lib/privacy.mjs
const REDACTION_RULES = [
  // API keys / tokens
  {
    name: 'api_key',
    pattern: /\b(sk-[a-zA-Z0-9\-_]{20,}|Bearer\s+[a-zA-Z0-9\-_.]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36})\b/g,
    replacement: '[API_KEY]'
  },
  // Passwords in DSN / connection strings
  {
    name: 'db_password',
    pattern: /((?:postgres|mysql|mongodb|redis):\/\/[^:]+:)[^@\s]+(@)/g,
    replacement: '$1[PASS]$2'
  },
  // Generic password= patterns
  {
    name: 'password_param',
    pattern: /\b(password|passwd|pwd|secret|token)\s*[=:]\s*\S+/gi,
    replacement: '$1=[REDACTED]'
  },
  // Private key headers
  {
    name: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[PRIVATE_KEY]'
  },
  // Home directory paths with username
  {
    name: 'home_path',
    pattern: /\/(home|Users)\/([a-zA-Z0-9_\-]+)\//g,
    replacement: '/$1/[USER]/'
  },
  // Private IP addresses
  {
    name: 'private_ip',
    pattern: /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[PRIVATE_IP]'
  },
  // AWS-style access keys
  {
    name: 'aws_key',
    pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[AWS_ACCESS_KEY]'
  },
]

export function redact(text, privacyMode = 'standard') {
  if (privacyMode === 'off') return text
  
  let result = text
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}
```

### 2.3 脱敏范围说明

覆盖：
- API keys（sk-、Bearer、ghp_ 等格式）
- 数据库连接字符串中的密码
- `password=xxx` 格式的配置值
- PEM 格式私钥
- 包含用户名的 home 目录路径（`/home/alice/` → `/home/[USER]/`）
- 私有 IP 地址（RFC 1918 地址段）
- AWS IAM 密钥

**不覆盖**（刻意保留，因为是常见技术内容）：
- 文件名、相对路径
- 公网 IP 地址（通常是服务器地址，非敏感）
- 内部域名（当前无对应规则；如需可在 `REDACTION_RULES` 自行扩展）
- 代码变量名（即使叫 `apiKey`，值已被覆盖）

### 2.4 domain_terms（注意：不是脱敏白名单）

```json
{
  "domain_terms": ["MyApp", "UserService", "PROD_DB"]
}
```

> ⚠️ **`domain_terms` 与脱敏无关**。它只被 `prompts.mjs` 注入到优化器 system prompt（"Additional domain terms to preserve"），告诉模型在改写时**保留**这些项目专有词。`privacy.mjs` 完全不引用 `domain_terms`，因此它**不会**让任何内容豁免脱敏。如果某术语恰好匹配脱敏规则（如形如 `sk-...` 的串），仍会被脱敏。

---

## 3. 本地存储安全

### 3.1 文件权限

数据目录与数据库文件设置为仅当前用户可访问：

```javascript
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })   // 数据目录 0o700（db.mjs / config.mjs）
fs.chmodSync(dbPath, 0o600)                            // data.db 0o600（db.mjs getDb，best-effort）
fs.writeFileSync(configPath, json, { mode: 0o600 })   // config.json / spaces.json 0o600
```

### 3.2 跨项目数据隔离

My Lingo 将所有项目的 prompt 混合存储（按语言空间分）。这是一个已知的设计取舍：

**理由**：学习材料应跨项目积累，用户的英语错误模式是个人特征，不依赖项目。

**隐患**：私有项目 B 的内部架构信息可能出现在基于所有历史生成的课程中。

**缓解措施**：
1. `turns.cwd` 列记录每条 turn 的项目路径（便于审计与未来按项目清理）。注意：当前 `/my-lingo:purge` 只支持按空间或全量清理，**尚无 `--cwd` 按项目删除**（见 §6.2）
2. 课程生成默认只读取最近 N 天的数据（`generate-lesson.mjs --days`），降低历史跨项目影响
3. 需要彻底清理时使用 `/my-lingo:purge --all`

---

## 4. 外部 API 安全

### 4.1 发送内容

**同步优化路径（`callFastModel`）** 发给外部 fast model 的只有：
- 脱敏后的用户 prompt
- 插件的 system prompt（固定内容，无用户数据）
- 检测到的源语言代码

**SessionEnd 学习分析 / 课程生成路径（`callDeepModel`）** 还会发送（均经 `redactMessages` 脱敏）：
- 本会话的 `original_prompt → execution_prompt` 对（从 DB 读回）
- ⚠️ **Claude 的文本回复**：v0.4 起 Stop hook 捕获的 `responses` 会作为"目标语言高质量示范"送入分析（`analysis.mjs:36-42`）。这是 v0.2 文档"不含 Claude 回复"承诺的**有意变更**——它确实外发，但同样经过出站脱敏。

**不发送**：
- 完整文件内容（除非用户自己粘贴进 prompt）
- 用户配置信息 / 凭证
- 与本次分析无关的历史数据

### 4.2 API 通信

- 通过 HTTPS（curl 默认验证证书）
- 不支持自签名证书（生产环境不应绕过 TLS 验证）
- API key 通过请求头传输，不写入日志

### 4.3 本地 API（隐私模式）

用户可配置本地运行的 Ollama 等服务作为 API，完全避免数据外传：

```json
{
  "api_base_url": "http://localhost:11434/v1",
  "privacy_mode": "off"
}
```

`privacy_mode: "off"` 时跳过脱敏（因为是本地 API，无需脱敏）。

---

## 5. Hook 安全

### 5.1 输入验证

Hook 脚本从 stdin 读取用户 prompt，需防止注入：

```javascript
function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}  // 解析失败时安全退出
  }
}
```

### 5.2 路径处理

读取配置文件时使用 `path.join` 而非字符串拼接，防止路径穿越：

```javascript
// 正确
const configPath = path.join(getDataDir(), 'config.json')

// 错误（路径穿越风险）
const configPath = dataDir + '/' + userInput + '/config.json'
```

### 5.3 命令执行

唯一的命令执行是 `spawnSync('curl', [...])` 调用外部 API。curl 的参数都是固定的，除了：
- `api_base_url`：从配置文件读取，不来自用户 prompt
- 请求体：经过 JSON.stringify 处理，不会产生 shell 注入

---

## 6. 用户数据控制

### 6.1 查看命令

- `/my-lingo:last` — 查看上一条记录
- `/my-lingo:recent 10` — 查看最近 10 条

### 6.2 删除命令

当前 `purge.md` 实际支持的参数（`storage.purgeSpace` / `purgeAll`）：

```
/my-lingo:purge                # 清空当前活跃语言空间的学习数据（corrections + items）
/my-lingo:purge --all          # 清空所有数据（turns / responses / corrections / items），默认含 sessions
/my-lingo:purge --all --keep-config  # 同上，但保留 sessions 摘要
```

> 未实现（文档历史遗留，勿当作可用）：`--space <key>`、`--before <date>`、`--cwd <path>` 按维度定向删除。如需可在 `storage.mjs` + `purge.md` 补齐。

所有 purge 操作需要用户输入 "yes" 确认。

### 6.3 导出命令（v0.3）

```
/my-lingo:export                    # 导出当前语言空间的学习材料为 Markdown
/my-lingo:export --space english    # 导出指定语言空间
```

导出时可选择是否包含原始 prompt（默认不包含，只导出学习材料）。
