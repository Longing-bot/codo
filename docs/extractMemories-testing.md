# extractMemories 测试指南

_补充日期：2026-04-03 04:00 UTC_

## 单元测试

### 1. 触发检查测试

```ts
// tests/extractMemories.trigger.test.ts
import { checkTrigger, resetExtractionState } from '../src/memory/extractMemories';

describe('Trigger Logic', () => {
  beforeEach(() => {
    resetExtractionState();
  });

  test('24小时未提取则触发', () => {
    const state = { lastExtraction: Date.now() - 25 * 60 * 60 * 1000, sessionCountSinceLast: 0 };
    expect(checkTrigger(state, {})).toBe(true);
  });

  test('5个会话后触发', () => {
    const state = { lastExtraction: Date.now(), sessionCountSinceLast: 5 };
    expect(checkTrigger(state, {})).toBe(true);
  });

  test('未到阈值不触发', () => {
    const state = { lastExtraction: Date.now(), sessionCountSinceLast: 0 };
    expect(checkTrigger(state, {})).toBe(false);
  });
});
```

### 2. 存储去重测试

```ts
// tests/extractMemories.store.test.ts
import { storeMemories, getMemories, clearMemories } from '../src/memory/store';

describe('Memory Store', () => {
  beforeEach(() => clearMemories());

  test('存储并检索', async () => {
    await storeMemories([{
      type: 'fact',
      content: '主人使用 Windows',
      confidence: 0.95,
      source: { messageId: 'msg_1', turn: 1 },
      timestamp: Date.now()
    }]);

    const all = getMemories();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('主人使用 Windows');
  });

  test('语义去重（高相似度合并）', async () => {
    const mem1 = { content: '主人使用 Windows', confidence: 0.95, type: 'fact', source: { messageId: 'm1', turn: 1 }, timestamp: Date.now() };
    const mem2 = { content: '主人用 Windows 系统', confidence: 0.92, type: 'fact', source: { messageId: 'm2', turn: 2 }, timestamp: Date.now() };

    await storeMemories([mem1, mem2]);
    const all = getMemories();
    // 应合并或丢弃一个
    expect(all.length).toBeLessThanOrEqual(1);
  });
});
```

### 3. Prompt 解析测试

```ts
// tests/extractMemories.analyzer.test.ts
import { parseExtractionResponse } from '../src/memory/analyzer';

describe('LLM Response Parsing', () => {
  test('正确解析 JSON 数组', () => {
    const response = `
      [
        {
          "type": "preference",
          "content": "主人偏好经济情报",
          "confidence": 0.9,
          "source_message_id": "msg_123"
        }
      ]
    `;

    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('preference');
  });

  test('过滤低置信度', () => {
    const response = `
      [
        { "type": "fact", "content": "测试", "confidence": 0.4, "source_message_id": "msg_1" },
        { "type": "fact", "content": "有效", "confidence": 0.8, "source_message_id": "msg_2" }
      ]
    `;

    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('有效');
  });

  test('处理无效 JSON（外层 markdown 代码块）', () => {
    const response = '```json\n[{"type":"fact","content":"OK","confidence":0.9,"source_message_id":"m"}]\n```';
    const result = parseExtractionResponse(response);
    expect(result[0].content).toBe('OK');
  });
});
```

## 集成测试

### 完整流程测试

```ts
// tests/extractMemories.integration.test.ts
import { runMemoryExtraction } from '../src/memory/extractMemories';
import { clearMemories, getMemories } from '../src/memory/store';

describe('End-to-End Extraction', () => {
  beforeEach(() => {
    clearMemories();
    // 模拟会话记忆
    mockSessionMemory({ sessionCount: 5, lastExtraction: 0 });
  });

  test('完整提取流程', async () => {
    // 模拟对话历史
    const messages = [
      { role: 'user', content: '我用 Windows 系统，不要用 markdown 表' },
      { role: 'assistant', content: '收到，我会避免使用 markdown 表格' },
      { role: 'user', content: '另外，我喜欢简短回复' },
    ];

    await runMemoryExtraction(messages);

    const memories = getMemories();
    expect(memories.length).toBeGreaterThan(0);

    // 检查提取结果
    const preferences = memories.filter(m => m.type === 'preference');
    expect(preferences.some(p => p.content.includes('markdown'))).toBe(true);
    expect(preferences.some(p => p.content.includes('简短'))).toBe(true);
  });
});
```

## 手动测试步骤

1. 编译运行：
```bash
cd /root/edgecli
npm run build
node dist/index.js
```

2. 进行 5 轮对话，观察是否自动触发提取
3. 检查 `memory/long-term.json` 是否新增条目
4. 重启 edgecli，验证记忆是否被注入上下文（检查系统消息中是否出现 `[相关记忆]`）

## 性能测试

- 提取耗时应 < 2s（不影响用户体验）
- 存储读写应 < 100ms
- 去重计算（小规模）< 50ms

## 覆盖率目标

- 触发逻辑：100%
- 存储 CRUD：100%
- 解析容错：90%+
- 去重逻辑：80%+

## 持续集成

建议在 GitHub Actions 中添加：
```yaml
- name: Test
  run: npm test -- --coverage
- name: Upload coverage
  uses: codecov/codecov-action@v3
```

---

_需待自主引擎恢复后实现这些测试_
