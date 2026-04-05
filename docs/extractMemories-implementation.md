# extractMemories 实现指南

_补充日期：2026-04-03 03:30 UTC（阻塞期间）_

## 技术实现细节

### 1. 核心架构

**模块职责：**
- `MemoryExtractor` — 触发检测与提取协调
- `MemoryAnalyzer` — 使用 LLM 分析对话历史
- `MemoryStore` — 结构化存储与去重
- `MemoryContext` — 提供检索接口供 agent 调用

**目录结构建议：**

```
src/memory/
├── extractMemories.ts      # 主入口（MemoryExtractor）
├── analyzer.ts             # 分析器（LLM prompt + parsing）
├── store.ts                # 存储层（JSON/DB）
├── types.ts                # 类型定义
├── sessionMemory.ts        # 会话记忆（已有，需扩展接口）
└── tests/
    └── extractMemories.test.ts
```

### 2. 触发检查（Stop Hook 集成）

在 `src/agent/query.ts` 或主循环中添加 stop hook：

```ts
// 在初始化时注入
agent.addStopHook(async ({ state }) => {
  const extractionState = await getExtractionState();
  const shouldTrigger = checkTrigger(extractionState, state);
  
  if (shouldTrigger) {
    // fire-and-forget，不阻塞
    triggerExtraction(state.recentMessages).catch(console.error);
    // 重置计数
    resetExtractionState();
  }
});
```

**触发条件：**
```ts
function checkTrigger(state: MemoryExtractionState, agentState: AgentState): boolean {
  const timePassed = Date.now() - state.lastExtraction > 24 * 60 * 60 * 1000;
  const sessionsPassed = state.sessionCountSinceLast >= 5;
  return timePassed || sessionsPassed;
}
```

### 3. 提取 Prompt 设计

使用系统 prompt 要求 LLM 输出 JSON：

```
你是一个记忆管理器。分析以下对话历史，提取结构化信息。

输出格式（JSON 数组）：
[
  {
    "type": "fact|preference|task_result|error_pattern",
    "content": "简洁描述",
    "confidence": 0.0-1.0,
    "source_message_id": "msg_123"
  }
]

提取标准：
- fact: 用户提到的客观事实（如"我用 Windows"）
- preference: 用户明确表达的偏好（如"不要用 markdown 表"）
- task_result: 任务完成结果（如"edgecli 已优化，速度提升 30%"）
- error_pattern: 反复出现的错误（如"权限问题需提升"）
- confidence: 提取把握度，低于 0.6 请勿输出

只输出 JSON，不要解释。
```

**调用方式（fire-and-forget）：**

```ts
async function triggerExtraction(messages: Message[]) {
  const recent = messages.slice(-50); // 最近 50 条
  
  const response = await callLLM({
    model: modelName, // 可配置，或用默认
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      ...recent.map(m => ({ role: m.role, content: m.content }))
    ],
    temperature: 0.1,
    maxTokens: 1000
  });
  
  const memories = parseJSON(response) as ExtractedMemory[];
  await storeMemories(memories.filter(m => m.confidence >= 0.6));
}
```

### 4. 存储与去重

**存储位置：** `memory/long-term.json`

```json
{
  "version": "1.0",
  "updated": 1703275200000,
  "memories": [
    {
      "id": "mem_abc123",
      "type": "preference",
      "content": "主人偏好国际政治经济情报",
      "confidence": 0.95,
      "source": { "messageId": "msg_456", "turn": 12 },
      "created": 1703275200000,
      "lastUsed": null,
      "usageCount": 0
    }
  ]
}
```

**去重逻辑（语义相似度）：**

- 新记忆到来时，与现有记忆计算 embedding 相似度
- 若最大相似度 > 0.9，则合并或丢弃
- 使用本地 embedding 模型（如 `@xenova/transformers`）或调用 LLM 摘要比较

**简化版（初期）：** 文本相似度（Levenshtein > 85%）或关键词匹配。

### 5. 上下文检索

在 agent loop 准备上下文时，注入相关记忆：

```ts
async function enrichWithMemories(messages: Message[], limit: number = 5) {
  const query = messages[messages.length - 1].content;
  const relevant = await searchMemories(query, limit);
  
  if (relevant.length > 0) {
    const memoryBlock = formatMemories(relevant);
    messages.splice(-1, 0, {
      role: 'system',
      content: `[相关记忆]\n${memoryBlock}`
    });
  }
  
  return messages;
}
```

**检索方法：**
- 基于关键词的 BM25（轻量，优先）
- 或 embedding 相似度搜索（准确，需要向量库）

### 6. 压缩与剪枝

每周运行一次压缩任务（cron 或 heartbeat 触发）：

```ts
function compressMemories(memories: Memory[]) {
  // 1. 去重合并
  // 2. 删除低置信且长时间未使用的
  // 3. 相似内容合并为摘要
  return optimizedMemories;
}
```

### 7. 测试计划

**单元测试：**
- Extraction trigger logic（时间/会话计数）
- Prompt parsing（模拟 LLM 返回）
- Store operations（增删查）
- Deduplication（相似文本）

**集成测试：**
- 模拟完整对话历史 → 触发提取 → 验证存储
- 上下文注入 → 检查 messages 结构

**手动测试：**
- 运行 edgecli 真实对话，观察 memory/long-term.json 增长
- 验证后续对话是否使用了历史记忆

### 8. 配置项（config.ts）

```ts
export const memoryConfig = {
  extraction: {
    intervalHours: 24,
    sessionThreshold: 5,
    recentMessageCount: 50,
    minConfidence: 0.6,
    deduplicationThreshold: 0.9,
    model: 'default' // 或指定特定模型
  },
  storage: {
    path: 'memory/long-term.json',
    maxMemories: 1000,
    compressionIntervalDays: 7
  }
};
```

### 9. 风险与缓解

- **LLM 幻觉**：设置低 temperature，二次验证（如有）
- **隐私泄露**：仅本地提取，不发送原始对话（只发摘要 prompt）
- **性能**：fire-and-forget，异步进行；storage 使用事务
- **存储膨胀**：定期压缩，硬上限

### 10. 实施顺序（建议）

1. 创建 `analyzer.ts` + prompt 测试（离线测试）
2. 实现 `store.ts`（JSON 读写，去重）
3. 修改 `sessionMemory.ts` 增加计数接口
4. 注入 stop hook（需要改主循环）
5. 上下文检索集成（agent 输入增强）
6. 压缩任务（后续独立）

---

**注意：** 需要等待自主引擎批准通道恢复后才能实施。
