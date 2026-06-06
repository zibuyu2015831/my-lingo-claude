# 隐私与安全设计

版本：v0.2

---

## 1. 威胁模型

My Lingo 在用户本机运行，通过外部 API 处理用户 prompt。主要隐私风险：

1. **外部 API 接收敏感内容**：用户的 prompt 可能包含 API key、密码、内部主机名、私有代码等
2. **本地 JSONL 文件包含明文**：历史 prompt 存储在本地，可能被其他进程读取
3. **跨项目数据混合**：公开项目和私有项目的 prompt 存在同一个数据库中
4. **Hook 脚本权限**：hook 以当前用户权限运行，需防止路径穿越等攻击

---

## 2. 脱敏策略

### 2.1 脱敏时机

| 阶段 | standard 模式 | strict 模式 |
|------|-------------|-------------|
| 发送给外部 API 前 | ✅ 脱敏 | ✅ 脱敏 |
| 写入本地 JSONL | ❌ 不脱敏（原始） | ✅ 脱敏 |

用户有权查看自己的原始 prompt，所以 standard 模式下本地存原文。

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
- 内部域名（用户可通过 `strict` 模式额外处理）
- 代码变量名（即使叫 `apiKey`，值已被覆盖）

### 2.4 domain_terms 白名单

用户可配置不被脱敏的术语（通常是项目专有词）：

```json
{
  "domain_terms": ["MyApp", "UserService", "PROD_DB"]
}
```

---

## 3. 本地存储安全

### 3.1 文件权限

创建 JSONL 文件时设置适当权限：

```javascript
fs.writeFileSync(filePath, content, { mode: 0o600 })  // 只有当前用户可读写
```

或在 `ensureDir` 时：
```javascript
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
```

### 3.2 跨项目数据隔离

My Lingo 将所有项目的 prompt 混合存储（按语言空间分）。这是一个已知的设计取舍：

**理由**：学习材料应跨项目积累，用户的英语错误模式是个人特征，不依赖项目。

**隐患**：私有项目 B 的内部架构信息可能出现在基于所有历史生成的课程中。

**缓解措施**：
1. `cwd` 字段记录每条 turn 的项目路径，用户可通过 `purge --cwd /path/to/project` 删除特定项目的记录
2. `strict` 模式下连项目路径也脱敏
3. 课程生成时可选择只使用最近 N 天的数据，降低历史跨项目影响

---

## 4. 外部 API 安全

### 4.1 仅发送必要内容

发给外部 API 的只有：
- 脱敏后的用户 prompt
- 插件的 system prompt（固定内容，无用户数据）
- 目标/源语言代码

**不发送**：
- 完整文件内容
- Claude 的回复（SessionEnd 时的学习分析只基于 turn 记录，不含 Claude 回复）
- 用户配置信息
- 历史数据

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

```
/my-lingo:purge                     # 清空当前语言空间的学习数据（保留配置）
/my-lingo:purge --all               # 清空所有数据（包括所有语言空间）
/my-lingo:purge --keep-config       # 只清数据，保留 config.json 和 spaces.json
/my-lingo:purge --space japanese    # 只清指定语言空间
/my-lingo:purge --before 2026-01-01 # 清除指定日期前的记录
```

所有 purge 操作需要用户输入 "yes" 确认。

### 6.3 导出命令（v0.3）

```
/my-lingo:export                    # 导出当前语言空间的学习材料为 Markdown
/my-lingo:export --space english    # 导出指定语言空间
```

导出时可选择是否包含原始 prompt（默认不包含，只导出学习材料）。
