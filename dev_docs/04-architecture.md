# 系统架构设计

版本：v0.6

---

## 1. 整体架构

> 存储自 v0.5 起为 SQLite（单库 `data.db`）；v0.4 加入 Stop hook 捕获回复；v0.6 加入 SessionStart 补偿触发。

```
用户输入
   │
   ▼
UserPromptSubmit Hook（Node.js，同步；hook 超时 60s，API 调用超时 8s）
   │
   ├─ 前缀分流：-- 跳过优化(记 raw) / :: 进入 refine（均先于 shouldSkip）
   ├─ 跳过检测（slash命令 '/' / 纯代码 / 过短 / URL·shell前缀）→ 直接通过
   ├─ 读取配置（config.json + spaces.json，5 层合并）
   ├─ 语言检测（本地 ASCII 比率，< 1ms，二分类 en/non-english）
   ├─ execution_mode 解析
   │   ├─ off → 直接通过
   │   ├─ original → 记录 + 直接通过
   │   └─ english_optimized / original_with_english_context / preview
   │       └─ 熔断检查 → 调用外部 fast model（curl, 同步, --max-time 8s, 出站脱敏）
   │           ├─ 成功 → execution_prompt_en（recordApiSuccess）
   │           └─ 失败/超时 → recordApiFailure → fallback_policy
   ├─ 写入 turns（DB，analyzed=0）
   └─ 返回 { additionalContext, systemMessage }
              │
              ▼
        Claude Code 执行 → Claude 回复给用户
              │
              ▼
     Stop Hook（每轮回复后）：尾读 transcript，写 responses（DB），< 200ms，无 API
              │
              ▼
     SessionEnd Hook（会话结束）
              │
              ├─ readUnanalyzedTurns（DB，analyzed=0）；空则退出（幂等）
              ├─ 统计 optimized / translated / corrected / fallbacks / raws → stderr
              ├─（v0.2+）读 responses，批量调用 deep model 生成 corrections/learning_items
              └─ 单事务：写 corrections/items/sessions + markTurnsAnalyzed（网络调用在事务外）

     SessionStart Hook（新会话启动，v0.6）
       └─ 若有其他 session 的未分析 turns 且 analysis.lock 不新鲜 → detached spawn session-end.mjs

用户执行命令（/my-lingo:xxx）
   │
   ▼
commands/my-lingo/*.md（Claude workflow）
   │
   ├─ 经 install.json 指针定位 → import scripts/lib/* → 读 data.db
   ├─（按需）调用外部 deep model 生成课程/画像
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
     → hook 脚本同步执行（API curl 超时 8s；hook 配置超时 60s）
     → hook 进程写入 turns（data.db），输出 JSON 到 stdout
     → hook 进程退出
     → Claude Code 读取 hook 输出，注入 additionalContext
     → Claude 开始处理 prompt

[每轮回复完成]
     → Claude Code 启动 Stop hook 进程 → 尾读 transcript，写 responses（data.db），< 200ms

[会话结束]
     → Claude Code 启动 SessionEnd hook 进程
     → 读 data.db（未分析 turns + responses），分析后单事务提交，统计输出 stderr
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
  
  // 写入 turns（data.db）
  writeTurn({ ...detection, execution_prompt: result.execution_prompt }, config)
  
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

SessionEnd hook 在 Claude 会话结束时触发，可执行较长时间（`hooks.json` 配置 timeout: **60s**；deep model 调用上限 `deep_timeout_seconds`=55s，必须小于 hook 超时）。

### 4.1 职责

```javascript
// SessionEnd hook（session-end.mjs）
1. readUnanalyzedTurns(sessionId)：DB 中 analyzed=0 的 turns；空 → 退出（幂等）
2. 统计：总数 / optimized / translated / corrected / fallbacks / raws
3. stderr 输出摘要（终端可见）
4. readResponsesForSession：读本 session 的 Claude 回复（DB）
5. （v0.2+）buildAnalysisMessages → callDeepModel（网络调用，置于事务外）
6. 单事务：写 corrections/learning_items/sessions + markTurnsAnalyzed(ids) 原子提交
7. finally：释放 analysis.lock（v0.6）
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
workflow 指令：经 storage.mjs 从 data.db 读取最近 7 天的 turns + corrections
     ↓
（有 deep model 配置时）调用外部 API 生成课程内容
     ↓
格式化输出 markdown 课程
```

关键点：命令的 API 调用**不在** hook 的 8 秒超时限制内，可以执行更长时间（30-60s）做深度分析。

---

## 6. 文件 I/O 设计

### 6.1 读写模式（v0.5 起为 SQLite）

| 操作 | 介质 | 频率 |
|------|------|------|
| 读配置 | `config.json`（JSON） | 每次 hook 调用 |
| 读语言空间 | `spaces.json`（JSON） | 每次 hook 调用 |
| 读/写熔断 | `circuit.json`（JSON） | API 失败/成功时 |
| 写 turn | `data.db` → `turns` 表 | 每次 UserPromptSubmit |
| 写 response | `data.db` → `responses` 表 | 每次 Stop |
| 写 corrections/items/sessions | `data.db` | SessionEnd（单事务）|
| 读历史 | `data.db`（按 `substr(ts,1,10/7)` 切片查询）| 命令执行时 |

读写经 `storage.mjs` → `db.mjs`（`getDb()` 单例 + WAL + `busy_timeout=3000`），多 hook 进程并发由 SQLite 串行化写入，无需应用层锁。

### 6.2 规模与性能

WAL 单库，单条 turn ~数百字节。日常 50 prompt/天量级下，索引查询（`idx_turns_ts` / `idx_turns_analyzed` 等）足够快；连接构造用 `PRAGMA user_version` 短路 initSchema，避免每轮重复建表（F12）。

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
