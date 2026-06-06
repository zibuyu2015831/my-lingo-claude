My Lingo Claude Code 插件方案设计文档

版本：v0.1
项目名：My Lingo
插件名：my-lingo
仓库名建议：my-lingo-claude
默认语言空间：English / My English preset
核心命令前缀：/my-lingo:xxx

⸻

1. 项目背景

在 Claude Code 的日常使用中，用户经常会用中文或其他非英语语言向 AI 描述开发需求。但在实际编码、架构分析、错误排查、代码审查等场景中，英文 Prompt 往往能带来更清晰、更稳定的模型理解效果。

同时，用户每天与 Claude Code 的真实交互，本身也是非常高质量的语言学习素材。相比背诵通用教材，基于真实工作输入生成的学习材料更贴近用户实际需求，也更容易长期坚持。

因此，My Lingo 的目标不是做一个普通翻译插件，而是：

把用户每天真实的 AI 交互，转化为更好的 Claude Code 执行 Prompt，同时沉淀为个性化语言学习材料。

⸻

2. 产品定位

2.1 一句话定位

My Lingo 是一个面向 Claude Code 的个人语言学习与 Prompt 增强插件。它会根据用户配置，将输入优化为更适合 Claude Code 理解的执行 Prompt，并基于真实交互记录生成目标语言学习材料、常见错误画像和个性化课程。

Claude Code 插件可以扩展 skills、agents、hooks、MCP servers 等能力，适合将 My Lingo 做成一个自包含的可安装插件；插件技能也会自动带上插件命名空间，因此 /my-lingo:lesson 这类命令形式是合理的。 ￼

⸻

3. 核心价值

3.1 对 Claude Code 使用效果的价值

My Lingo 可以将用户的原始输入转化为结构更清晰、约束更明确、上下文更完整的英文执行 Prompt。

例如用户输入：

检查这个项目有没有架构问题，先不要修改代码。

普通翻译可能是：

Check whether this project has architecture problems. Do not modify the code first.

My Lingo 应该生成：

Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks.

区别在于：My Lingo 不只是翻译，而是进行 AI Coding 场景下的 Prompt 优化。

⸻

3.2 对语言学习的价值

My Lingo 会保存用户真实输入、优化后的目标语言文本、Claude 回复、错误分析、常用句型和高频词汇，并据此生成个人化学习材料。

它学习的不是泛泛的英语、日语、德语，而是：

用户在真实 AI 编程场景中最需要的目标语言表达。

例如：

用户原始表达：
check this code have bug
优化表达：
Check whether this code has any bugs.
更适合 Claude Code 的表达：
Review this code and identify any potential bugs, edge cases, or unsafe assumptions.

后续可以沉淀为：

错误类型：语法错误 + 中式表达
学习重点：
1. check whether ...
2. this code has ...
3. identify potential bugs
4. edge cases

⸻

4. 名称设计

4.1 最终名称

产品名：My Lingo
插件名：my-lingo
仓库名：my-lingo-claude
默认 preset：My English

4.2 为什么不继续叫 My English

my-english 很适合最初的英语学习场景，但后续需求已经扩展为任意语言学习。用户可能同时学习英语、日语、德语、法语等多门语言，所以正式产品名不应限制在 English。

4.3 My Lingo 的优势

my：强调个人化、私有化、长期积累
lingo：表示语言、表达、学习，不局限英语
my-lingo：适合作为 Claude Code 插件 namespace

命令语义也自然：

/my-lingo:lesson
/my-lingo:profile
/my-lingo:errors
/my-lingo:use japanese
/my-lingo:last

⸻

5. 产品目标

My Lingo 有两个并列目标。

5.1 目标一：提升 Claude Code 回复质量

通过 Prompt 优化，让 Claude Code 获得更清晰、更结构化、更适合执行的输入。

重点包括：

1. 将非英文输入转化为高质量英文执行 Prompt
2. 将不自然英文改写为自然、准确、清晰的英文 Prompt
3. 自动补充合理的 Prompt 结构，例如目标、边界、输出格式
4. 保留代码、路径、日志、变量名、命令等技术内容
5. 避免过度改写，不能改变用户原始意图

5.2 目标二：帮助用户学习目标语言

通过真实交互积累学习材料。

重点包括：

1. 将用户输入转换为当前语言空间的学习文本
2. 展示翻译或优化后的目标语言文本，帮助用户阅读输入
3. 保存用户输入、优化文本和 Claude 回复
4. 分析用户常见错误
5. 总结高频词汇、句型和表达模式
6. 生成个性化学习课程
7. 支持多语言空间，允许用户切换当前学习语言

⸻

6. 核心概念设计

⸻

6.1 用户输入语言

用户实际输入的语言。

可能是：

中文
英文
日语
德语
法语
中英混合
任意自然语言

字段建议：

input_language

⸻

6.2 当前学习语言空间

用户当前正在学习的语言空间。

例如：

English Space
Japanese Space
German Space
French Space

字段建议：

active_language_space

每个语言空间独立保存：

目标语言
学习文本
错误记录
高频词汇
常用句型
学习课程
复习记录
语言画像
展示偏好
学习等级

⸻

6.3 Claude 执行模式

前面讨论过“输入给 Claude Code 的内容始终为英文”，但进一步思考后，这应该是默认推荐模式，而不是不可改变的硬规则。

因此设计为：

execution_mode

可选值：

english_optimized
original
original_with_english_context
preview
off

⸻

7. Execution Mode 设计

⸻

7.1 english_optimized

默认模式。

含义：

用户输入任意语言
↓
My Lingo 生成英文优化 Prompt
↓
Claude Code 以英文优化 Prompt 为主要执行依据
↓
当前语言空间异步生成学习文本

适合场景：

日常编码
代码审查
架构分析
错误排查
测试生成
重构任务

优势：

Claude Code 理解更稳定
Prompt 更结构化
结果质量更容易控制

⸻

7.2 original

原始输入模式。

含义：

用户输入什么，就让 Claude Code 按什么处理
My Lingo 只做记录和异步学习分析
不干预 Claude Code 执行

适合场景：

用户故意想用中文或目标语言和 Claude 交互
用户想测试模型对原始输入的理解
用户不希望插件改写当前任务
用户处理非常精确或敏感的输入

⸻

7.3 original_with_english_context

混合模式。

含义：

原始输入保留
My Lingo 额外生成英文优化版
英文优化版作为上下文提供给 Claude

适合场景：

用户希望保留原始语言表达
但也希望 Claude 看到英文参考版本

⸻

7.4 preview

预览确认模式。

含义：

用户输入
↓
插件生成英文执行 Prompt 和学习文本
↓
展示给用户
↓
用户确认后再发送

适合场景：

开发调试阶段
用户担心插件误改意图
重要任务执行前

缺点：

会打断 Claude Code 的流畅交互

⸻

7.5 off

关闭模式。

含义：

不改写
不保存
不分析

适合临时停用插件。

⸻

8. 语言空间设计

8.1 为什么需要语言空间

用户可能同时学习两门或多门语言。如果所有数据混在一起，会导致：

英语错误和日语错误混杂
不同语言的学习材料难以区分
课程生成不准确
用户画像失真

因此必须设计独立的 Language Space。

⸻

8.2 语言空间示例

English Space
- target_language: en
- native_language: zh-CN
- level: intermediate
- display_mode: compact
Japanese Space
- target_language: ja
- native_language: zh-CN
- level: beginner
- display_mode: full
German Space
- target_language: de
- native_language: zh-CN
- level: A1
- display_mode: compact

⸻

8.3 语言空间命令

/my-lingo:spaces
/my-lingo:space
/my-lingo:use english
/my-lingo:use japanese
/my-lingo:create-space japanese
/my-lingo:delete-space german

推荐高频命令：

/my-lingo:use japanese

含义非常清楚：切换当前学习语言为空间 Japanese。

⸻

9. 用户交互设计

⸻

9.1 查看状态

/my-lingo:status

输出示例：

# My Lingo Status
- Active language space: Japanese
- Execution mode: english_optimized
- Display mode: compact
- Saved turns: 328
- Pending jobs: 4
- API provider: openai_compatible
- SQLite path: ~/.claude/plugins/data/my-lingo/my_lingo.db

⸻

9.2 查看当前语言空间

/my-lingo:space

输出示例：

# Current Language Space
Name: Japanese
Target language: ja
Native language: zh-CN
Level: beginner
Display mode: compact
Stats:
- Turns: 42
- Errors: 18
- Lessons: 2
- Learning items: 163

⸻

9.3 切换语言空间

/my-lingo:use english
/my-lingo:use japanese
/my-lingo:use german

输出示例：

Switched active language space to Japanese.
Execution mode remains: english_optimized.

⸻

9.4 查看最近一次转换

/my-lingo:last

输出示例：

# Last My Lingo Turn
## Original Input
检查这个项目有没有架构问题，先不要修改代码。
## Claude Execution Prompt
Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks.
## Learning Text / Japanese
このプロジェクトにアーキテクチャ上の問題がないか確認してください。まだコードは変更せず、まずモジュールの境界、データフロー、保守性、拡張性、潜在的なリスクについて構造化された分析を行ってください。
## Learning Points
1. アーキテクチャ上の問題  
   架构层面的问题。
2. まだコードは変更せず  
   先不要修改代码。
3. 構造化された分析  
   结构化分析。

⸻

9.5 切换执行模式

/my-lingo:mode
/my-lingo:mode english
/my-lingo:mode raw
/my-lingo:mode mixed
/my-lingo:mode preview
/my-lingo:mode off

别名建议：

english -> english_optimized
raw     -> original
mixed   -> original_with_english_context

⸻

9.6 生成课程

/my-lingo:lesson
/my-lingo:lesson --days 7
/my-lingo:lesson --type grammar
/my-lingo:lesson --type prompt
/my-lingo:lesson --type vocab

输出内容应基于当前语言空间。

⸻

9.7 查看常见错误

/my-lingo:errors

英语空间示例：

# Common English Errors
## 1. want Claude check
Your expression:
I want Claude check this file.
Better:
I want Claude to check this file.
Pattern:
want someone to do something

日语空间示例：

# Common Japanese Errors
## 1. 助词使用不稳定
你的表达中经常混淆「を」「に」「で」。
Example:
このファイルに確認してください。
Better:
このファイルを確認してください。

⸻

9.8 查看语言画像

/my-lingo:profile

画像应包含：

常见语言错误
常见 Prompt 结构问题
高频词汇
高频句型
最近进步趋势
下阶段学习建议

⸻

10. Claude Code 插件实现基础

Claude Code 插件可以包含 skills、agents、hooks、MCP servers 等组件；插件目录中的 .claude-plugin/plugin.json 用于声明插件身份，skills、hooks、agents 等组件应位于插件根目录，而不是 .claude-plugin/ 内。 ￼

插件 skills 会自动带上插件名作为命名空间，例如 /plugin-name:skill-name，所以 My Lingo 的命令形式应为 /my-lingo:lesson、/my-lingo:profile、/my-lingo:last。 ￼

Claude Code 的命令以 / 开头，命令后的文本会作为参数传递，因此 /my-lingo:lesson --days 7 这种设计是合理的。 ￼

⸻

11. 重要技术限制

11.1 UserPromptSubmit 的限制

UserPromptSubmit 会在用户提交 prompt 后、Claude 处理前运行，并且 hook 输入中包含用户提交的 prompt 字段。它可以添加上下文、验证 prompt 或阻止 prompt，但它更适合“注入上下文”而不是“无痕替换用户原始输入”。 ￼

因此，第一版插件模式中，最稳妥的实现方式是：

通过 UserPromptSubmit 生成英文执行 Prompt
↓
通过 additionalContext 注入给 Claude
↓
明确告诉 Claude：以英文执行 Prompt 为主要任务指令

但如果未来要严格保证“Claude Code 真正收到的主输入只有英文”，则需要后期实现 wrapper 模式。

⸻

11.2 additionalContext 不会作为普通聊天消息显示

additionalContext 会被加入 Claude 的上下文中，Claude 能看到，但它不会以普通聊天消息形式展示在界面中。 ￼

这意味着：

用 hook 可以影响 Claude 的理解
但不能天然满足“每次都向用户展示翻译文本”的学习需求

因此需要额外设计：

/my-lingo:last
/my-lingo:recent
display_mode
后期 wrapper 实时展示模式

⸻

11.3 异步 hook 的限制

Claude Code 支持异步 command hook，异步 hook 可以在后台运行而不阻塞 Claude；但异步 hook 不能阻止或控制当前行为，输出也通常要到下一轮交互才会进入上下文。 ￼

因此：

生成当前轮 execution_prompt：必须同步
生成 learning_text / errors / lesson：适合异步

⸻

12. 推荐总体架构

User Input
   ↓
Claude Code Hook / Wrapper
   ↓
Mode Resolver
   ↓
Language Space Manager
   ↓
Sync Fast Path
   ├─ Detect input language
   ├─ Generate execution prompt if needed
   ├─ Save turn record
   └─ Inject / send execution prompt to Claude
   ↓
Claude Code Response
   ↓
Stop Hook
   └─ Save assistant reply
   ↓
Async Worker
   ├─ Generate learning text
   ├─ Analyze language errors
   ├─ Extract vocab and sentence patterns
   ├─ Update profile
   └─ Build lessons

⸻

13. 同步与异步设计

13.1 同步关键路径

同步路径只做当前轮必须完成的事情：

1. 读取当前 active language space
2. 解析 execution_mode
3. 必要时调用外部 API 生成 execution_prompt
4. 写入 turns 表
5. 通过 additionalContext 注入 Claude

目标耗时：

理想：1-3 秒
可接受上限：5-8 秒
超过则按 fallback_policy 处理

同步路径不应该做：

完整错误分析
课程生成
词汇提取
长期画像更新
多轮统计
复杂导出

⸻

13.2 异步后台路径

异步任务包括：

生成当前语言空间 learning_text
分析语言错误
提取学习点
提取高频词汇
提取常用句型
保存 Claude 回复后的学习材料
更新语言画像
生成课程
导出 Markdown

⸻

13.3 为什么需要异步

如果每次用户输入都等待完整翻译、纠错、学习点提取、课程更新，会严重影响 Claude Code 的交互效率。

所以原则是：

同步路径服务 Claude Code 执行效果；异步路径服务语言学习沉淀。

⸻

14. 外部 API 设计

所有涉及 AI 翻译、Prompt 优化、错误分析、课程生成的部分使用外部 API。

建议支持 OpenAI-compatible API，方便接入不同模型服务：

OpenAI-compatible provider
OpenRouter
DeepSeek
Qwen
火山引擎
本地 OpenAI-compatible server
其他兼容接口

配置项：

api_base_url
api_key
model_fast
model_deep
timeout_seconds
max_retries
max_concurrent_jobs

14.1 模型分层

Fast Model

用于同步路径：

生成 execution_prompt
基础语言检测
快速 Prompt 优化

要求：

速度快
成本低
JSON 输出稳定
不会过度发挥

Deep Model

用于异步路径：

学习文本生成
错误分析
课程生成
语言画像
长期总结

要求：

质量更高
可接受更慢
分析更细

⸻

15. 数据存储设计

15.1 为什么使用 SQLite

My Lingo 是个人、本地、低运维工具。SQLite 足够满足：

本地持久化
低复杂度
易备份
易迁移
无需服务端
无需 Redis / PostgreSQL

Claude Code 插件提供 ${CLAUDE_PLUGIN_DATA} 作为持久数据目录，可用于保存 SQLite 数据库、缓存、依赖和其他跨版本保留的数据；该目录一般解析到 ~/.claude/plugins/data/{id}/。 ￼

推荐数据库路径：

${CLAUDE_PLUGIN_DATA}/my_lingo.db

⸻

15.2 SQLite 并发设置

建议初始化时启用：

PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

原因：

WAL 适合读多写少的本地应用
busy_timeout 可以缓解并发写冲突
foreign_keys 保证数据一致性

⸻

16. 数据库 Schema 设计

⸻

16.1 language_spaces

CREATE TABLE language_spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  target_language_code TEXT NOT NULL,
  native_language_code TEXT NOT NULL,
  level TEXT,
  is_active INTEGER DEFAULT 0,
  display_mode TEXT DEFAULT 'compact',
  auto_generate_learning_text INTEGER DEFAULT 1,
  save_assistant_reply INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

说明：

key: english / japanese / german
display_name: English / Japanese / German
target_language_code: en / ja / de
native_language_code: zh-CN
is_active: 当前是否为激活语言空间

⸻

16.2 turns

CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language_space_id INTEGER NOT NULL,
  session_id TEXT,
  transcript_path TEXT,
  cwd TEXT,
  project_name TEXT,
  created_at TEXT NOT NULL,
  original_prompt TEXT NOT NULL,
  detected_input_language TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'english_optimized',
  fallback_policy TEXT,
  input_sent_to_claude TEXT,
  input_sent_type TEXT,
  execution_language TEXT DEFAULT 'en',
  execution_prompt_en TEXT,
  english_context TEXT,
  learning_text TEXT,
  learning_text_status TEXT,
  learning_text_displayed INTEGER DEFAULT 0,
  rewrite_type TEXT,
  rewrite_status TEXT,
  rewrite_latency_ms INTEGER,
  prompt_quality_score INTEGER,
  language_quality_score INTEGER,
  correction_json TEXT,
  learning_points_json TEXT,
  prompt_improvements_json TEXT,
  assistant_reply TEXT,
  assistant_reply_saved INTEGER DEFAULT 1,
  privacy_level TEXT,
  redaction_applied INTEGER DEFAULT 0,
  mode_override_source TEXT,
  FOREIGN KEY(language_space_id) REFERENCES language_spaces(id)
);

重点字段：

execution_mode：本轮执行模式
input_sent_to_claude：实际发送或注入给 Claude 的内容
input_sent_type：original / english_optimized / original_with_context
execution_prompt_en：英文执行 Prompt
learning_text：当前语言空间学习文本

⸻

16.3 language_errors

CREATE TABLE language_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language_space_id INTEGER NOT NULL,
  turn_id INTEGER,
  target_language_code TEXT NOT NULL,
  error_type TEXT,
  original_text TEXT,
  corrected_text TEXT,
  explanation_native TEXT,
  severity TEXT,
  pattern_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(language_space_id) REFERENCES language_spaces(id),
  FOREIGN KEY(turn_id) REFERENCES turns(id)
);

⸻

16.4 learning_items

CREATE TABLE learning_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language_space_id INTEGER NOT NULL,
  turn_id INTEGER,
  item_type TEXT,
  source_text TEXT,
  target_text TEXT,
  native_explanation TEXT,
  example_sentence TEXT,
  difficulty TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(language_space_id) REFERENCES language_spaces(id),
  FOREIGN KEY(turn_id) REFERENCES turns(id)
);

item_type 可选：

word
phrase
sentence
grammar
prompt_pattern
expression
mistake

⸻

16.5 lessons

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  language_space_id INTEGER NOT NULL,
  title TEXT,
  lesson_type TEXT,
  source_start TEXT,
  source_end TEXT,
  content_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(language_space_id) REFERENCES language_spaces(id)
);

⸻

16.6 jobs

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  language_space_id INTEGER,
  turn_id INTEGER,
  payload_json TEXT,
  result_json TEXT,
  error_message TEXT,
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

任务类型：

generate_learning_text
analyze_language_errors
extract_learning_items
save_assistant_reply
build_profile
build_lesson
export_materials

⸻

16.7 settings

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

⸻

17. 插件目录结构设计

推荐目录：

my-lingo-claude/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── status/
│   │   └── SKILL.md
│   ├── space/
│   │   └── SKILL.md
│   ├── spaces/
│   │   └── SKILL.md
│   ├── use/
│   │   └── SKILL.md
│   ├── mode/
│   │   └── SKILL.md
│   ├── last/
│   │   └── SKILL.md
│   ├── recent/
│   │   └── SKILL.md
│   ├── lesson/
│   │   └── SKILL.md
│   ├── profile/
│   │   └── SKILL.md
│   ├── errors/
│   │   └── SKILL.md
│   ├── vocab/
│   │   └── SKILL.md
│   ├── sentences/
│   │   └── SKILL.md
│   ├── review/
│   │   └── SKILL.md
│   ├── export/
│   │   └── SKILL.md
│   └── purge/
│       └── SKILL.md
├── hooks/
│   ├── hooks.json
│   ├── user_prompt_submit.py
│   ├── stop_capture.py
│   └── stop_failure.py
├── mcp/
│   └── server.py
├── my_lingo/
│   ├── __init__.py
│   ├── config.py
│   ├── db.py
│   ├── models.py
│   ├── language_space.py
│   ├── mode_resolver.py
│   ├── prompt_optimizer.py
│   ├── learning_text.py
│   ├── analyzer.py
│   ├── lesson_builder.py
│   ├── privacy.py
│   ├── api_client.py
│   ├── jobs.py
│   └── worker.py
├── scripts/
│   ├── init_db.py
│   ├── run_worker.py
│   └── migrate.py
├── tests/
├── README.md
└── pyproject.toml

注意：.claude-plugin/ 里只放 plugin.json，skills、hooks、agents、MCP 配置等组件应放在插件根目录。 ￼

⸻

18. plugin.json 设计

示例：

{
  "name": "my-lingo",
  "version": "0.1.0",
  "description": "A personal Claude Code language-learning and prompt-enhancement plugin.",
  "author": "Zane",
  "skills": "./skills",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./mcp/server.json",
  "userConfig": {
    "api_base_url": {
      "type": "string",
      "title": "API Base URL",
      "description": "OpenAI-compatible API base URL.",
      "required": true
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "API key for the external translation and optimization model.",
      "sensitive": true,
      "required": true
    },
    "model_fast": {
      "type": "string",
      "title": "Fast Model",
      "description": "Model used for synchronous execution prompt optimization.",
      "required": true
    },
    "model_deep": {
      "type": "string",
      "title": "Deep Model",
      "description": "Model used for asynchronous analysis and lesson generation.",
      "required": false
    },
    "native_language": {
      "type": "string",
      "title": "Native Language",
      "description": "Your native language for explanations.",
      "default": "zh-CN"
    },
    "default_target_language": {
      "type": "string",
      "title": "Default Target Language",
      "description": "Default language space target language.",
      "default": "en"
    },
    "default_execution_mode": {
      "type": "string",
      "title": "Default Execution Mode",
      "description": "english_optimized, original, original_with_english_context, preview, or off.",
      "default": "english_optimized"
    }
  }
}

Claude Code 插件支持 userConfig，可以在启用插件时提示用户配置；敏感字段可以标记为 sensitive，用于 API key 这类凭证。 ￼

⸻

19. Hook 设计

⸻

19.1 UserPromptSubmit

职责：

1. 捕获用户输入
2. 读取当前语言空间
3. 读取 execution_mode
4. 根据模式决定是否调用外部 API
5. 生成英文执行 Prompt 或英文上下文
6. 写入 turns 表
7. 创建异步学习任务
8. 通过 additionalContext 注入 Claude
9. 必要时阻止本轮 prompt

Claude Code 的 UserPromptSubmit hook 会在每次用户 prompt 提交后、Claude 处理前运行，并会阻塞模型处理直到 hook 完成，因此这里必须保持轻量、快速。 ￼

⸻

19.2 Stop

职责：

1. 捕获 Claude 最后一条回复
2. 更新 turns.assistant_reply
3. 创建异步学习任务
4. 标记当前 turn 完成

Stop hook 会在主 Claude Code agent 完成回复时运行，并且输入中包含 last_assistant_message，因此可以保存 Claude 回复而无需解析 transcript。 ￼

⸻

19.3 StopFailure

职责：

1. 记录 Claude Code API 错误
2. 标记当前 turn 失败
3. 保留错误类型和错误详情

适合记录：

rate_limit
authentication_failed
billing_error
server_error
model_not_found
unknown

⸻

20. Hook 配置示例

{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python \"${CLAUDE_PLUGIN_ROOT}/hooks/user_prompt_submit.py\"",
            "timeout": 8
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python \"${CLAUDE_PLUGIN_ROOT}/hooks/stop_capture.py\"",
            "timeout": 10
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python \"${CLAUDE_PLUGIN_ROOT}/hooks/stop_failure.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}

⸻

21. Prompt 优化协议

外部 API 应输出稳定 JSON。

21.1 英文执行 Prompt 输出

{
  "detected_input_language": "zh-CN",
  "execution_mode": "english_optimized",
  "execution_prompt_en": "Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks.",
  "prompt_quality_score": 82,
  "rewrite_type": "translate_and_optimize",
  "prompt_improvements": [
    {
      "type": "execution_boundary",
      "issue": "The original prompt did not explicitly specify whether code changes are allowed.",
      "suggestion": "Add: Do not modify any files yet."
    }
  ]
}

⸻

21.2 学习文本输出

{
  "target_language": "ja",
  "learning_text": "このプロジェクトにアーキテクチャ上の問題がないか確認してください。まだコードは変更せず、まずモジュールの境界、データフロー、保守性、拡張性、潜在的なリスクについて構造化された分析を行ってください。",
  "learning_points": [
    {
      "type": "phrase",
      "target_text": "アーキテクチャ上の問題",
      "native_explanation": "架构层面的问题"
    },
    {
      "type": "sentence_pattern",
      "target_text": "まだコードは変更せず",
      "native_explanation": "先不要修改代码"
    }
  ]
}

⸻

21.3 错误分析输出

{
  "target_language": "en",
  "corrections": [
    {
      "type": "grammar",
      "original": "this code have bug",
      "corrected": "this code has bugs",
      "explanation_native": "code 在这里作为单数概念，动词应使用 has。"
    },
    {
      "type": "expression",
      "original": "check this code have bug",
      "corrected": "check whether this code has any bugs",
      "explanation_native": "英文中更自然的表达是 check whether..."
    }
  ]
}

⸻

22. Prompt 优化规则

必须写入模型系统提示：

1. Do not change the user's intent.
2. Do not add requirements that are not implied by the user.
3. Preserve code blocks, commands, logs, paths, identifiers, URLs, branch names, package names, and error messages.
4. Optimize the prompt for Claude Code usage.
5. Prefer clear task boundaries.
6. If the user asks for analysis, do not turn it into implementation.
7. If the user asks to implement, preserve that intent.
8. If the original prompt is ambiguous, add only minimal clarification.
9. Output valid JSON only.
10. Never expose secrets or sensitive values in generated learning materials.

⸻

23. 隐私与安全设计

My Lingo 会保存真实输入和 Claude 回复，可能包含敏感内容。

23.1 可能包含的敏感信息

API key
数据库密码
服务器 IP
生产日志
.env 内容
私钥
证书
内部项目名称
公司代码片段
用户私人想法

23.2 默认安全策略

1. 默认本地 SQLite 保存
2. 默认不上传历史数据库
3. API 请求前进行敏感信息脱敏
4. 跳过 .env、私钥、证书内容
5. 支持关闭 assistant_reply 保存
6. 支持只保存摘要，不保存原文
7. 支持 /my-lingo:purge 一键清空数据
8. 支持按语言空间删除数据
9. 支持导出前二次脱敏

Claude Code hook 是在用户本机执行的命令，拥有当前用户权限，因此 hook 脚本必须严格校验输入、避免路径穿越、避免处理敏感文件。官方文档也提醒 command hooks 会以用户系统权限运行，应谨慎验证和清洗输入。 ￼

⸻

24. Display Mode 设计

语言学习需要“看见”目标语言文本。展示不能完全隐藏在后台。

24.1 可选展示模式

off
compact
full
learning_only
execution_only
both

⸻

24.2 compact

默认推荐。

# My Lingo / Japanese
このプロジェクトにアーキテクチャ上の問題がないか確認してください。
Key patterns:
- 〜に問題がないか確認する
- まだコードは変更せず

⸻

24.3 full

# My Lingo Turn
## Original
检查这个项目有没有架构问题，先不要修改代码。
## Execution Prompt
Review this project for potential architectural issues. Do not modify any files yet.
## Learning Text
このプロジェクトにアーキテクチャ上の問題がないか確認してください。まだコードは変更しないでください。
## Learning Points
1. 〜に問題がないか確認する
2. まだコードは変更しないでください

⸻

24.4 插件模式下的展示限制

由于 additionalContext 不会作为普通聊天消息展示，所以第一版可以通过以下方式满足学习展示：

/my-lingo:last
/my-lingo:recent
/my-lingo:lesson

后期如果要做到每次输入后自动展示，应优先考虑 wrapper 模式。

⸻

25. Wrapper 模式设计

25.1 为什么需要 Wrapper

Claude Code 原生 hook 更适合上下文注入，不适合严格替换用户原始输入。如果最终目标是：

Claude Code 实际收到的主输入就是英文优化 Prompt
并且用户每次都能看到目标语言学习文本

则需要 wrapper。

⸻

25.2 Wrapper 命令

my-lingo claude

或短命令：

mlingo

⸻

25.3 Wrapper 流程

用户输入原始语言
↓
Wrapper 捕获输入
↓
调用外部 API 生成 execution_prompt 和 learning_text
↓
在终端展示 learning_text
↓
将 execution_prompt 发送给 Claude Code
↓
保存 Claude 回复
↓
后台分析和生成学习材料

⸻

25.4 Wrapper 的阶段定位

第一版不建议做 wrapper。

原因：

开发复杂度高
需要处理 Claude Code 交互式终端
需要处理输入输出流
需要适配 Claude Code 行为变化

建议：

MVP：先做 Claude Code 插件模式
正式增强版：再做 wrapper 模式

⸻

26. 课程生成设计

26.1 课程类型

mixed
vocab
grammar
sentence
prompt
errors
review

⸻

26.2 课程结构

# My Lingo Lesson
## 1. 本期摘要
## 2. 高频错误
## 3. 高频词汇
## 4. 常用句型
## 5. 原始表达 → 推荐表达
## 6. Prompt 优化技巧
## 7. 练习题
## 8. 下次重点

⸻

26.3 英语课程示例

# My English Lesson
## 1. 高频表达：Check whether ...
你的原句：
check this code have bug
推荐表达：
Check whether this code has any bugs.
更适合 Claude Code：
Review this code and identify any potential bugs, edge cases, or unsafe assumptions.
解析：
- check whether = 检查是否
- has any bugs = 是否有 bug
- identify potential bugs = 找出潜在问题

⸻

26.4 日语课程示例

# My Japanese Lesson
## 1. 常用表达：〜に問題がないか確認する
原始中文：
检查这个项目有没有架构问题。
日语表达：
このプロジェクトにアーキテクチャ上の問題がないか確認してください。
解析：
- 〜に問題がないか = 是否在……方面存在问题
- 確認してください = 请确认 / 请检查

⸻

27. 用户画像设计

/my-lingo:profile 应输出当前语言空间的长期画像。

27.1 英语画像

1. 高频语法错误
2. 高频中式英语表达
3. 高频技术表达问题
4. 高频 Prompt 结构问题
5. 最近改善趋势
6. 下阶段学习重点

27.2 日语画像

1. 助词错误
2. 敬体 / 常体混用
3. 技术表达不自然
4. 中文语序迁移
5. 高频句型
6. 下阶段学习重点

27.3 Prompt 画像

不管用户学习什么语言，都应保留 Prompt 质量分析：

目标是否明确
上下文是否充足
是否指定输出格式
是否说明是否允许修改代码
是否区分分析和执行
是否提供验收标准
是否有优先级

⸻

28. 配置层级设计

推荐四层配置：

本次输入 override
> 项目配置
> 当前语言空间配置
> 全局默认配置

示例：

全局默认：
execution_mode = english_optimized
Japanese Space：
display_mode = full
某项目：
execution_mode = original
本次输入：
/my-lingo:mode preview

⸻

29. fallback 策略

新增配置：

fallback_policy

可选值：

block
send_original
send_original_with_warning
ask

29.1 推荐默认

在 english_optimized 模式下：

fallback_policy = ask

如果英文优化失败：

1. 用户输入本身是英文：允许发送原英文
2. 用户输入不是英文：提示重试或切换 raw

在 original 模式下：

fallback_policy = send_original

⸻

30. MVP 范围

第一版必须收敛，重点打通闭环。

30.1 MVP 必须实现

1. my-lingo 插件骨架
2. plugin.json
3. hooks/UserPromptSubmit
4. hooks/Stop
5. SQLite 初始化
6. language_spaces 表
7. 默认 English 语言空间
8. /my-lingo:status
9. /my-lingo:spaces
10. /my-lingo:use
11. /my-lingo:mode
12. /my-lingo:last
13. 同步生成英文 execution_prompt
14. 保存原始输入和执行 Prompt
15. 异步生成 learning_text
16. 保存 Claude 回复
17. 基础隐私脱敏

⸻

30.2 MVP 暂不实现

1. Wrapper 模式
2. Anki 导出
3. 向量数据库
4. 多端同步
5. GUI
6. 完整间隔复习
7. 复杂学习曲线
8. 云端账户系统
9. 多用户系统

⸻

31. 实现路径

⸻

阶段 0：插件骨架验证

目标：

能被 Claude Code 加载
能看到 /my-lingo:status
UserPromptSubmit 能触发
Stop 能触发
SQLite 能写入

验收标准：

/my-lingo:status 正常输出
用户输入后 turns 表有记录
Claude 回复后 assistant_reply 被保存

⸻

阶段 1：语言空间

目标：

创建 language_spaces 表
创建默认 English Space
支持 /my-lingo:spaces
支持 /my-lingo:use
支持 /my-lingo:space

验收标准：

能创建多个语言空间
能切换当前 active language space
turns 能正确关联 language_space_id

⸻

阶段 2：执行 Prompt 优化

目标：

接入外部 API
实现 english_optimized 模式
生成 execution_prompt_en
通过 additionalContext 注入 Claude

验收标准：

中文输入能生成英文执行 Prompt
英文输入能被修正和优化
代码块、路径、命令不被破坏
失败时按 fallback_policy 处理

⸻

阶段 3：异步学习文本生成

目标：

创建 jobs 表
实现 worker
生成当前语言空间 learning_text
支持 /my-lingo:last 展示

验收标准：

用户输入后立即不被长时间阻塞
后台能生成 learning_text
/my-lingo:last 能看到原文、执行 Prompt、学习文本

⸻

阶段 4：错误分析与学习点

目标：

生成 language_errors
生成 learning_items
支持 /my-lingo:errors
支持 /my-lingo:vocab
支持 /my-lingo:sentences

验收标准：

能总结用户常见错误
能提取高频词汇
能提取常用句型

⸻

阶段 5：课程与画像

目标：

支持 /my-lingo:lesson
支持 /my-lingo:profile
支持 /my-lingo:review

验收标准：

课程内容来自真实历史输入
画像能反映当前语言空间
能输出最近 7 天 / 30 天趋势

⸻

阶段 6：导出与清理

目标：

支持 /my-lingo:export
支持 /my-lingo:purge
支持按语言空间导出
支持按语言空间删除

验收标准：

能导出 Markdown
能清空指定语言空间
能保留或删除全局配置

⸻

阶段 7：Wrapper 模式

目标：

实现 my-lingo claude 或 mlingo
真正捕获用户输入
真正发送英文执行 Prompt 给 Claude Code
实时展示学习文本

验收标准：

用户输入中文
终端展示目标语言学习文本
Claude Code 实际执行英文 Prompt
交互体验不明显下降

⸻

32. 风险与应对

32.1 风险一：Hook 不能真正替换原始输入

应对：

MVP 使用 additionalContext 注入英文执行 Prompt
后期通过 wrapper 实现严格替换

⸻

32.2 风险二：实时 API 调用拖慢 Claude Code

应对：

同步路径只生成 execution_prompt
设置 5-8 秒超时
失败按 fallback_policy 处理
学习分析全部异步

⸻

32.3 风险三：Prompt 被过度改写

应对：

严格系统提示
禁止改变用户意图
保留代码和技术文本
记录 original_prompt 和 execution_prompt_diff
支持 preview 模式
支持 raw 模式

⸻

32.4 风险四：隐私泄露

应对：

本地 SQLite
敏感信息脱敏
支持关闭 Claude 回复保存
支持 purge
API 请求前过滤 secrets

⸻

32.5 风险五：多语言分析质量不稳定

应对：

先重点做好 English Space
其他语言作为可配置扩展
错误分析按目标语言适配
使用 model_deep 做异步高质量分析

⸻

33. 推荐最终默认配置

{
  "native_language": "zh-CN",
  "default_target_language": "en",
  "default_language_space": "english",
  "execution_mode": "english_optimized",
  "fallback_policy": "ask",
  "display_mode": "compact",
  "learning_text_generation": "async",
  "save_original_prompt": true,
  "save_execution_prompt": true,
  "save_learning_text": true,
  "save_assistant_reply": true,
  "secret_redaction": true,
  "max_concurrent_jobs": 2,
  "sync_timeout_seconds": 8,
  "async_timeout_seconds": 60
}

⸻

34. 最终产品边界

My Lingo 不应该变成：

通用翻译器
完整英语学习 App
背单词软件
聊天机器人
复杂学习平台
Claude Code 替代前端

它应该保持克制：

My Lingo 只做一件事：把用户每天真实的 Claude Code 交互，变成更好的执行 Prompt 和更有价值的语言学习材料。

⸻

35. 最终总结

My Lingo 的最终设计原则是：

1. 执行层优先服务 Claude Code 效果
2. 学习层服务用户长期语言提升
3. 默认英文优化，但允许原始输入
4. 支持多个语言空间
5. 同步路径必须轻
6. 学习分析尽量异步
7. 数据本地 SQLite 保存
8. 外部 API 只负责 AI 翻译、优化和分析
9. 第一版先做插件模式
10. 后期再做 wrapper 严格模式

一句话总结：

My Lingo = Claude Code Prompt 增强层 + 多语言学习空间 + 个人语言错误画像系统。
