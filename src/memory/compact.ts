// ─── Context Compaction (CC Architecture) ───────────────────────────────────
// CC's compaction: summarize conversation when context gets too large
// Uses a structured prompt to preserve all critical context

export const COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is directly in line with the user's most recent explicit requests. If your last task was concluded, only list next steps if explicitly requested.

Here's an example of how your output should be structured:

<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [File Name 1]
     - [Why this file is important]
     - [Changes made]
     - [Important Code Snippet]

4. Errors and fixes:
   - [Error 1]: [How fixed]
   - [User feedback if any]

5. Problem Solving:
   [Description of solved problems]

6. All user messages:
   - [User message 1]
   - [User message 2]

7. Pending Tasks:
   - [Task 1]

8. Current Work:
   [Precise description]

9. Optional Next Step:
   [Next step]
</summary>

Please provide your summary based on the conversation so far.`

import { type Message } from '../config/index.js'
import { estimateMessageTokens } from './index.js'

export interface CompactResult {
  summary: string
  compactedMessages: Message[]
}

// CC pattern: compact conversation to a single summary message
export function buildCompactedMessages(summary: string): Message[] {
  return [
    { role: 'system', content: 'Previous conversation summary below. Use this context to continue the work.' },
    { role: 'user', content: `<conversation_summary>\n${summary}\n</conversation_summary>\n\nBased on the summary above, continue where we left off. What was the last thing being worked on?` },
  ]
}

// CC pattern: check if compaction is needed
export function shouldCompact(messages: Message[], maxTokens: number = 80000): boolean {
  return estimateMessageTokens(messages) > maxTokens
}

// ─── 5层压缩流水线（CC-inspired）────────────────────────────────────

const TOOL_RESULT_BUDGET = 4000  // 单个工具结果最大字符数

// Layer 1: Tool Result Budget — 截断超大的工具结果
export function applyToolResultBudget(messages: Message[]): Message[] {
  return messages.map(m => {
    if (m.role === 'tool' && m.content && m.content.length > TOOL_RESULT_BUDGET) {
      const truncated = m.content.slice(0, TOOL_RESULT_BUDGET)
      const omitted = m.content.length - TOOL_RESULT_BUDGET
      return { ...m, content: `${truncated}\n\n[... ${omitted} 字符已截断 ...]` }
    }
    return m
  })
}

// Layer 2: Microcompact — 压缩旧的工具结果（保留最近 N 轮）
export function microcompact(messages: Message[], keepRecentRounds: number = 4): Message[] {
  if (messages.length < 8) return messages

  // 找到最近 N 轮工具调用的边界
  let toolResultCount = 0
  let cutIndex = messages.length - 1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      toolResultCount++
      if (toolResultCount > keepRecentRounds * 2) {  // 每轮约2个工具结果
        cutIndex = i
        break
      }
    }
  }

  // 截断 cutIndex 之前的工具结果为摘要
  return messages.map((m, i) => {
    if (i < cutIndex && m.role === 'tool' && m.content && m.content.length > 200) {
      const lines = m.content.split('\n')
      const summary = lines.length > 3
        ? `${lines[0]}\n${lines[1]}\n... (${lines.length} 行, ${m.content.length} 字符)`
        : m.content.slice(0, 200) + '...'
      return { ...m, content: summary }
    }
    return m
  })
}

// Layer 3: Auto Compact — 全局压缩（最后手段）
export function autoCompactMessages(messages: Message[]): Message[] {
  if (messages.length < 6) return messages

  // 保留系统消息 + 最近 6 条
  const systemMsg = messages[0]
  const recent = messages.slice(-6)

  const middle = messages.slice(1, -6)
  const userMsgs = middle.filter(m => m.role === 'user')
  const toolCalls = middle.filter(m => m.role === 'tool')
  const summary = `[自动压缩] 之前 ${middle.length} 条消息已压缩。包含 ${userMsgs.length} 条用户消息和 ${toolCalls.length} 次工具调用。`

  return [
    systemMsg,
    { role: 'user', content: `<conversation_summary>\n${summary}\n</conversation_summary>\n\nBased on the summary above, continue where we left off.` },
    ...recent,
  ]
}

// 完整的压缩流水线：按层执行
export function runCompactionPipeline(messages: Message[]): { messages: Message[]; stagesRun: string[] } {
  const stagesRun: string[] = []
  let result = messages

  // Layer 1: 截断超大工具结果（每次都执行，廉价）
  const budgeted = applyToolResultBudget(result)
  if (budgeted !== result) stagesRun.push('tool_result_budget')
  result = budgeted

  // Layer 2: Microcompact（超过 16 条消息时执行）
  if (result.length > 16) {
    const micro = microcompact(result)
    if (micro !== result) stagesRun.push('microcompact')
    result = micro
  }

  // Layer 3: Auto compact（超过阈值时执行）
  if (shouldCompact(result, 200_000)) {
    result = autoCompactMessages(result)
    stagesRun.push('autocompact')
  }

  return { messages: result, stagesRun }
}

// CC pattern: get the compaction request messages
export function getCompactionRequest(messages: Message[]): Message[] {
  return [
    ...messages,
    { role: 'user', content: COMPACT_PROMPT },
  ]
}
