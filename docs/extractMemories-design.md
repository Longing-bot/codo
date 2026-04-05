# extractMemories — 长期记忆提取模块设计

_设计日期：2026-04-03 凌晨（阻塞期间的代码分析时段）_

## 背景与目标

Claude Code 自主性架构包含 `extractMemories` 机制，定期从对话历史中提取结构化记忆，补充到长期存储中，避免 token 浪费并保持上下文连贯。

edgecli 需要实现类似功能，作为 CC 差距之一（低优项）。

## CC 参考

基于已记录的 CC 原理（MEMORY.md）：
- autoDream 在 24h 或 5 sessions 后触发记忆整理
- memory extraction + prompt suggestion 并行 fire-and-forget
- 提取内容：重要事实、用户偏好、任务结果、错误模式

## edgecli 现状

从子代理提交消息（2026-04-02）可知：
- 已有 `memory/sessionMemory.ts`（会话级记忆，274行）
- 已有 `linter/index.ts`（代码检查）

这为提取模块提供了基础。

## 设计方案

### 1. 触发条件

```ts
const TRIGGER_INTERVAL_HOURS = 24;
const TRIGGER_SESSION_COUNT = 5;

// 状态追踪
interface MemoryExtractionState {
  lastExtraction: number; // timestamp
  sessionCountSinceLast: number;
}
```

### 2. 提取策略

**输入：** 最近的 N 条对话（可配置窗口大小）
**输出：** 结构化记忆条目

```ts
interface ExtractedMemory {
  type: 'fact' | 'preference' | 'task_result' | 'error_pattern';
  content: string;
  confidence: number; // 0-1
  source: { messageId: string; turn: number };
  timestamp: number;
}
```

**提取方法：**
- 使用 LLM 并行 fire-and-forget 调用（不阻塞主循环）
- Prompt 模板：要求模型提取以上 4 类信息
- 过滤低置信度（<0.6）条目
- 去重（与现有记忆语义相似度 >0.9 则跳过）

### 3. 存储

- 写入 `memory/long-term.json`（或 SQLite）
- 每次提取后合并，并定期（每周）压缩剪枝

### 4. 与现有模块集成

- 在 `agentLoop` / `query()` 的 stop hooks 中注入触发检查
- 与 `sessionMemory.ts` 配合：当会话计数达到阈值时，读取会话记忆 → 提取 → 保存 → 重置计数

### 5. 权限与安全

- 提取仅基于本地对话历史
- 不发送到外部（提取 LLM 调用使用默认模型配置）
- 结果仅用于后续上下文增强

## 实施步骤（代码改造）

1. 创建 `src/memory/extractMemories.ts`：核心提取逻辑
2. 扩展 `src/memory/sessionMemory.ts`：增加计数和触发接口
3. 修改 `src/agent/query.ts`（或 agent loop）：注入 stop hook 检查
4. 添加配置项（extraction interval、confidence threshold）
5. 单元测试 + 手动测试

## 优先级评估

- 当前高优：none（全部完成）
- 中优：none（全部完成）
- 低优：extractMemories
- 建议排期：待自主引擎恢复后，按任务队列顺序执行

## 待确认

- 是否使用独立的 low-cost 模型进行提取？（CC 使用同一模型）
- 记忆持久化格式（JSON vs SQLite）？edgecli 已用 SQLite，优先一致
