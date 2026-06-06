# My Lingo — 产品概述

版本：v0.2

---

## 1. 项目背景

在 Claude Code 的日常使用中，用户经常用中文或其他非英语语言描述开发需求。但在编码、架构分析、错误排查、代码审查等场景，英文 Prompt 往往能带来更清晰、更稳定的模型理解效果。

同时，用户每天与 Claude Code 的真实交互，本身是非常高质量的语言学习素材——相比背诵教材，基于真实工作输入生成的学习材料更贴近实际需求，也更容易长期坚持。

**My Lingo 的目标**：把用户每天真实的 AI 交互，转化为更好的 Claude Code 执行 Prompt，同时沉淀为个性化语言学习材料。

---

## 2. 一句话定位

My Lingo 是一个面向 Claude Code 的个人语言学习与 Prompt 增强插件。它将输入优化为更适合 Claude Code 理解的执行 Prompt，并基于真实交互记录生成目标语言学习材料、常见错误画像和个性化课程。

---

## 3. 两个并列目标

### 目标一：提升 Claude Code 回复质量

将用户的原始输入转化为结构更清晰、约束更明确、上下文更完整的英文执行 Prompt。

| 输入类型 | 处理方式 |
|---------|---------|
| 中文/日文/其他非英文 | 翻译 + 结构化优化 |
| 不自然英文（语法错误、中式表达）| 纠正 + 优化 |
| 清晰英文 | 轻量优化或直接通过 |
| 代码块、命令、URL | 保留不处理 |

**示例：**

用户输入（中文）：
> 检查这个项目有没有架构问题，先不要修改代码。

普通翻译：
> Check whether this project has architecture problems. Do not modify the code first.

My Lingo 优化后：
> Review this project for potential architectural issues. Do not modify any files yet. First provide a structured analysis covering module boundaries, data flow, maintainability, scalability, and potential risks.

### 目标二：帮助用户学习目标语言

通过真实交互积累学习材料，学习的是"用户在真实 AI 编程场景中最需要的目标语言表达"，而非泛泛的通用语言。

包括：
- 将用户输入转换为当前语言空间的学习文本
- 分析用户常见语言错误
- 总结高频词汇、句型和表达模式
- 生成个性化学习课程

---

## 4. 目标用户

**核心目标用户**：A2-B1 级别英语水平的开发者，使用中文或其他语言思考，希望同时改善英文 Prompt 质量和英语水平。

**次要用户**：母语非英文的进阶开发者，主要用于 Prompt 质量优化而非语言学习。

**不适合的用户**：
- 英语母语者（无翻译价值，Prompt 优化价值有限）
- 完全不需要 Claude Code 使用效果改善的用户

---

## 5. 产品边界

My Lingo **不**应该变成：

- 通用翻译器（不处理与 Claude Code 无关的翻译请求）
- 完整英语学习 App（没有完整课程体系、教学设计）
- 背单词软件（没有系统的词汇复习功能）
- 聊天机器人
- 复杂学习平台
- Claude Code 替代前端

**保持克制**：My Lingo 只做一件事——把用户每天真实的 Claude Code 交互，变成更好的执行 Prompt 和更有价值的语言学习材料。

---

## 6. 插件信息

| 字段 | 值 |
|------|-----|
| 产品名 | My Lingo |
| 插件名 | my-lingo |
| 仓库名 | my-lingo-claude |
| 命令前缀 | `/my-lingo:xxx` |
| 默认语言空间 | English |
| 实现语言 | Node.js |
| 存储方案 | JSONL（MVP），SQLite（v1.0+）|

---

## 7. 版本路线图概览

| 版本 | 里程碑 |
|------|--------|
| v0.1 MVP | 插件骨架 + 同步 Prompt 优化 + JSONL 存储 + 基础命令 |
| v0.2 | 多语言空间 + SessionEnd 学习分析 + 错误画像 |
| v0.3 | 课程生成 + 简化 SRS + 词汇提取 |
| v1.0 | SQLite 迁移 + Wrapper 模式 + 完整学习体系 |
