# 命令设计

版本：v0.2

所有命令以 `/my-lingo:` 为前缀。命令实现为 `commands/my-lingo/` 目录下的 markdown workflow 文件，由 Claude 读取数据并格式化输出。

---

## 命令总览

| 命令 | 阶段 | 功能 |
|------|------|------|
| `/my-lingo:setup` | MVP | 首次运行向导，配置 API 和默认语言空间 |
| `/my-lingo:status` | MVP | 显示当前配置和今日统计 |
| `/my-lingo:last` | MVP | 显示上一次的原始输入和执行 Prompt |
| `/my-lingo:mode [mode]` | MVP | 查看/切换执行模式 |
| `/my-lingo:space` | v0.2 | 查看当前语言空间详情 |
| `/my-lingo:spaces` | v0.2 | 列出所有语言空间 |
| `/my-lingo:use [lang]` | v0.2 | 切换当前语言空间 |
| `/my-lingo:recent [n]` | v0.2 | 查看最近 N 条记录 |
| `/my-lingo:errors` | v0.2 | 查看常见语言错误 |
| `/my-lingo:lesson` | v0.3 | 生成个性化学习课程 |
| `/my-lingo:vocab` | v0.3 | 查看高频词汇 |
| `/my-lingo:sentences` | v0.3 | 查看常用句型 |
| `/my-lingo:profile` | v0.3 | 查看语言画像 |
| `/my-lingo:review` | v0.3 | 今日复习（SRS）|
| `/my-lingo:export` | v0.3 | 导出学习材料 |
| `/my-lingo:purge` | v0.2 | 清空数据 |

---

## MVP 命令详情

### `/my-lingo:setup`

首次运行引导。

**触发时机**：用户首次安装插件，或 `config.json` 不存在时。

**交互流程**：
1. 提示用户配置 API Base URL（例：`https://api.openai.com/v1`）
2. 提示配置 API Key（存入 `userConfig`，Claude Code 加密保存）
3. 提示配置 Fast Model（例：`gpt-4o-mini`）
4. 提示配置 Deep Model（可选，默认同 Fast Model）
5. 提示配置母语（默认 `zh-CN`）
6. 创建默认 English 语言空间
7. 验证 API 连通性（发送测试请求）
8. 输出配置摘要

**配置验证**：向 API 发送一个简单请求，确认 API key 和模型有效。

---

### `/my-lingo:status`

查看当前状态。

**输出示例**：

```
# My Lingo Status

Active Language Space: English (en)
Execution Mode: english_optimized
Display Mode: compact
Fallback Policy: send_original
API Provider: openai_compatible (api.openai.com)
Fast Model: gpt-4o-mini

Today's Stats:
  Prompts processed: 12
  Optimizations: 10 (2 skipped)
  Translations: 3
  Corrections: 7
  Fallbacks: 0

Storage: ~/.claude/plugins/data/my-lingo/
  Turns today: 12 records
  Total turns: 328 records
```

---

### `/my-lingo:last`

显示上一次处理的记录。

**输出示例（english_optimized 模式）**：

```
# My Lingo — Last Turn
Time: 2026-06-06 10:23:45

## Original Input (zh-CN)
检查这个项目有没有架构问题，先不要修改代码。

## Execution Prompt (en)
Review this project for potential architectural issues. Do not modify any files yet.
First provide a structured analysis covering module boundaries, data flow,
maintainability, scalability, and potential risks.

Rewrite type: translate_and_optimize
Latency: 1.2s
```

**输出示例（raw 模式）**：

```
# My Lingo — Last Turn
Time: 2026-06-06 10:25:12
Mode: original (no optimization)

## Input
check this code have bug
```

---

### `/my-lingo:mode [mode]`

查看或切换执行模式。

**查看当前模式**：
```
/my-lingo:mode
```
输出：
```
Current execution mode: english_optimized
```

**切换模式**：
```
/my-lingo:mode raw
/my-lingo:mode english
/my-lingo:mode mixed
/my-lingo:mode preview
/my-lingo:mode off
```

别名映射：
- `english` → `english_optimized`
- `raw` → `original`
- `mixed` → `original_with_english_context`

**输出示例**：
```
Switched to mode: original (raw)
Note: Prompts will be sent to Claude as-is. Learning data collection paused.
Use /my-lingo:mode english to re-enable optimization.
```

---

## v0.2 命令详情

### `/my-lingo:use [language]`

切换当前语言空间。

```
/my-lingo:use english
/my-lingo:use japanese
/my-lingo:use german
```

**输出**：
```
Switched active language space to Japanese.
Target language: ja | Level: beginner | Display: full
Execution mode unchanged: english_optimized
```

若语言空间不存在：
```
Language space "german" not found.
Available spaces: english, japanese
Create it with: /my-lingo:space new german
```

---

### `/my-lingo:spaces`

列出所有语言空间。

**输出**：
```
# My Lingo Language Spaces

* English (active)
  Target: en | Native: zh-CN | Level: intermediate
  Turns: 312 | Items: 1,240 | Errors: 89

  Japanese
  Target: ja | Native: zh-CN | Level: beginner
  Turns: 16 | Items: 63 | Errors: 24
```

---

### `/my-lingo:recent [n]`

查看最近 N 条记录，默认 5。

```
/my-lingo:recent
/my-lingo:recent 10
```

---

### `/my-lingo:errors`

显示当前语言空间的常见错误。

**英语空间输出**：
```
# Common English Errors (English Space)
Based on last 30 days, 89 errors analyzed.

## Top Errors

### 1. Missing article (23 occurrences)
   Your expression: "check file exists"
   Better: "check if the file exists"
   Pattern: check if the [noun] [verb]

### 2. Verb agreement (18 occurrences)
   Your expression: "this code have bug"
   Better: "this code has a bug"
   Pattern: [singular noun] has

### 3. Preposition choice (12 occurrences)
   Your expression: "write result to the log"
   Better: "write the result to the log"
```

---

## v0.3 命令详情

### `/my-lingo:lesson [options]`

生成个性化学习课程。

```
/my-lingo:lesson
/my-lingo:lesson --days 7
/my-lingo:lesson --type grammar
/my-lingo:lesson --type vocab
/my-lingo:lesson --type prompt
```

课程内容来自：当前语言空间 + 指定时间范围内的真实 turns 和错误记录。

课程结构见 `06-learning-system.md`。

---

### `/my-lingo:profile`

显示当前语言空间的长期语言画像。

包括：
- 高频语法错误
- 高频表达问题
- 最近改善趋势（7天/30天）
- Prompt 质量分析
- 下阶段学习建议

---

### `/my-lingo:purge [options]`

清空数据（需确认）。

```
/my-lingo:purge                    # 清空当前语言空间
/my-lingo:purge --space english    # 清空指定语言空间
/my-lingo:purge --all              # 清空所有数据
/my-lingo:purge --keep-config      # 保留配置，只清数据
```

执行前显示确认提示，要求用户输入 "yes" 确认。

---

## 特殊 Prompt 前缀

这些不是命令，而是写在普通 prompt 前的前缀：

| 前缀 | 行为 |
|------|------|
| `::` | 强制触发 refine 模式（即使 auto_correct=false）|
| `!raw` | 本次跳过优化，直接发原始输入 |

**示例**：
```
!raw 这段日语我想直接让 Claude 翻译，不需要 My Lingo 处理
```
```
:: 我想让这个功能做到更健壮，要处理所有边界情况，还要有测试
```
（`::` 后的内容会被优化为精确的、结构化的英文执行 Prompt）
