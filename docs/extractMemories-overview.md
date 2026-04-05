# extractMemories — 模块概览

**目标：** 实现 Claude Code 风格的长期记忆提取，定期从对话历史中抽取结构化信息，用于后续上下文增强。

**位置：** `src/memory/extractMemories.ts`（新文件）

**核心流程：**
1. 停止钩子检测 → 时间或会话数达到阈值
2. 异步触发 → LLM 分析最近对话
3. 解析并过滤 → 置信度 > 0.6
4. 去重存储 → 写入 `memory/long-term.json`
5. 上下文检索 → agent 调用时自动注入相关记忆

**关键特性：**
- fire-and-forget，不阻塞主循环
- 四种记忆类型：fact / preference / task_result / error_pattern
- 语义去重（相似度 > 0.9 合并）
- 与 `sessionMemory.ts` 会话计数集成

**依赖：** 
- `src/memory/sessionMemory.ts`（已有）
- LLM 调用（沿用现有模型路由）

**配置：** `memoryConfig.extraction`（intervalHours, sessionThreshold, confidence 等）

**优先级：** 低优（待高优全部完成后实施）
