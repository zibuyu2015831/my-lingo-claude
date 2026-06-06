# 系统架构设计

版本：v0.2

---

## 1. 整体架构

```
用户输入
   │
   ▼
UserPromptSubmit Hook（Node.js，同步）
   │
   ├─ 跳过检测（slash命令/纯代码/过短）→ 直接通过
   │
   ├─ 语言检测（本地 ASCII 比率，< 1ms）
   │
   ├─ 读取配置（config.json + spaces.json）
   │
   ├─ execution_mode 解析
   │   ├─ off → 直接通过
   │   ├─ original → 记录 + 直接通过
   │   └─ english_optimized / mixed / preview
   │       └─ 调用外部 API（curl, 同步, 超时 8s）
   │           ├─ 成功 → 生成 execution_prompt_en
   │           └─ 失败/超时 → fallback_policy
   │
   ├─ 写入 turns JSONL（今日文件追加）
   │
   └─ 返回 { additionalContext, systemMessage }
              │
              ▼
        Claude Code 执行
              │
              ▼
       Claude 回复给用户
              │
              ▼
     SessionEnd Hook（Node.js）
              │
              ├─ 读取本次会话的 turns 记录
              ├─ 统计 corrections / translations / clean
              ├─ 识别本次会话的高频错误
              ├─（v0.2+）批量调用 deep model 生成学习摘要
              └─ stderr 输出会话统计

用户执行命令（/my-lingo:xxx）
   │
   ▼
commands/my-lingo/*.md（Claude workflow）
   │
   ├─ 读取 JSONL 文件（turns / learning / errors）
   ├─（按需）调用外部 API 生成课程/画像
   └─ 格式化输出给用户
```

---

## 2. 进程模型

### 2.1 无持久 Daemon

My Lingo 不使用持久后台进程。原因：
- Claude Code hook 以独立进程启动，执行完毕后退出
- 实现 daemon 需要 PID 管理、健康检查、重启逻辑，大幅增加复杂度
- 参考实现（`claude-english-buddy`）验证了"无 daemon"方案的可行性

### 2.2 Hook 进程生命周期

```
[用户按 Enter]
     → Claude Code 启动 UserPromptSubmit hook 进程
     → hook 脚本同步执行（最多 8-60s）
     → hook 进程写入 JSONL，输出 JSON 到 stdout
     → hook 进程退出
     → Claude Code 读取 hook 输出，注入 additionalContext
     → Claude 开始处理 prompt

[Claude 完成回复]
     → Claude Code 启动 SessionEnd hook 进程
     → SessionEnd hook 读取 JSONL，输出会话统计到 stderr
     → hook 进程退出
```

### 2.3 同步与"异步"的重新定义

原设计中的"异步 worker"在新架构中转化为：
- **会话内异步**：SessionEnd hook 可以做当次会话的批量分析（学习摘要）
- **按需异步**：用户执行 `/my-lingo:lesson` 时才调用 deep model 生成课程
- **无后台任务**：没有在 Claude Code 会话之外运行的任务

---

## 3. 同步关键路径

### 3.1 时序要求

```
用户按 Enter → [hook 开始] → ... → [hook 结束] → Claude 开始处理
                 ↑                                    ↑
             hook 开始时间                      用户感知延迟起点
```

目标延迟：
- 理想：1-2 秒（Fast model 快速响应）
- 可接受：< 5 秒
- 超时上限：8 秒（超时后走 fallback）

### 3.2 关键路径代码流

```javascript
async function main() {
  const input = readStdin()                          // < 1ms
  const prompt = input.prompt || ''
  const config = loadConfig(input.cwd)               // < 5ms（读文件）
  
  // 快速跳过
  if (shouldSkip(prompt)) { exit(0) }               // < 1ms
  
  // 本地检测
  const detection = detectLanguage(prompt)           // < 1ms
  
  // 读取语言空间配置
  const space = getActiveSpace(config)               // < 2ms
  
  // 执行模式分支
  if (config.execution_mode === 'off') { exit(0) }
  if (config.execution_mode === 'original') {
    writeTurn({ ...detection, fallback: false })
    exit(0)
  }
  
  // 调用外部 API（同步，最大瓶颈）
  const result = callFastModel(prompt, config)       // < 8s（超时）
  
  if (!result) {
    // Fallback
    writeTurn({ ...detection, fallback: true })
    emit(fallbackResponse(config))
    exit(0)
  }
  
  // 写入 JSONL
  writeTurn({ ...detection, execution_prompt: result.execution_prompt })
  
  // 输出给 Claude Code
  emit({
    additionalContext: buildContext(result, config),
    systemMessage: buildSystemMessage(result, detection)
  })
}
```

### 3.3 不应在同步路径中做的事

- 完整错误分析（有多次 API 调用）
- 课程生成
- 词汇提取
- 画像更新
- 读取大量历史数据
- 任何 I/O 密集操作

---

## 4. SessionEnd 路径

SessionEnd hook 在 Claude 会话结束时触发，可以执行较长时间（timeout: 15s）。

### 4.1 职责

```javascript
// SessionEnd hook
1. 读取今日 turns 文件
2. 过滤本次 session_id 的 turns
3. 统计：总数 / 优化数 / 翻译数 / fallback 数
4. 识别高频错误对（参考实现的 bucket by (original, corrected)）
5. stderr 输出摘要（终端可见）
6. （v0.2+）批量写入 learning items JSONL
```

### 4.2 输出格式

输出到 `stderr`（不影响 Claude Code 主流程）：

```
[my-lingo] Session: 8 prompts | 6 optimized (2 translated, 4 corrected) | 2 skipped | 0 fallbacks
Recurring this session: "have → has" (3x), "missing article" (2x)
```

---

## 5. 命令路径（按需分析）

用户执行 `/my-lingo:lesson` 等命令时，由 Claude 执行 markdown workflow：

```
/my-lingo:lesson --days 7
     ↓
Claude 读取 commands/my-lingo/lesson.md
     ↓
workflow 指令：读取最近 7 天的 turns JSONL + learning JSONL
     ↓
（有 deep model 配置时）调用外部 API 生成课程内容
     ↓
格式化输出 markdown 课程
```

关键点：命令的 API 调用**不在** hook 的 8 秒超时限制内，可以执行更长时间（30-60s）做深度分析。

---

## 6. 文件 I/O 设计

### 6.1 读取模式

| 操作 | 文件 | 频率 |
|------|------|------|
| 读配置 | `config.json` | 每次 hook 调用 |
| 读语言空间 | `spaces.json` | 每次 hook 调用 |
| 读熔断状态 | `circuit.json` | 每次 hook 调用 |
| 写 turn | `turns/YYYY-MM-DD.jsonl` | 每次 hook 调用（追加）|
| 读历史 | `turns/YYYY-MM-DD.jsonl` | 命令执行时 |
| 写学习项 | `learning/{space}/items-YYYY-MM.jsonl` | SessionEnd |
| 读/写熔断 | `circuit.json` | API 失败时 |

### 6.2 文件大小预估

每条 turn 记录约 200-500 字节（JSONL）。假设每天 50 次 prompt：
- 每日文件：~25KB
- 每月文件：~750KB
- 一年后：~9MB

JSONL 文件是顺序写入、按需读取，I/O 压力极低。

---

## 7. 错误处理策略

| 错误类型 | 处理方式 |
|---------|---------|
| API 超时 | 走 fallback，记录 `fallback: true` |
| API 认证失败 | systemMessage 提示，不重试 |
| API rate limit | 记录错误类型，walk fallback，熔断计数 +1 |
| JSON 解析失败 | 视为 fallback，记录原始响应前 200 字符 |
| 文件 I/O 失败 | 不影响主流程（hook 依然返回 additionalContext）|
| config 文件不存在 | 使用默认值，提示用户运行 `/my-lingo:setup` |
