// ─── Layer 3: Query Engine (CC Architecture) ───────────────────────────────
// CC's core pattern: while(true) { call_llm → collect tool_use → execute → yield → loop }
// Key CC features implemented:
//   - Stop hooks: post-processing after tool execution
//   - Tool-gated loop: only continues if model requests tools
//   - Context preservation: full message history for the model
//   - Error recovery: graceful handling of API errors

import { CodoConfig, Message, saveSession } from '../config/index.js'
import { callLLM } from '../api/index.js'
import { findTool, toOpenAI, toAnthropic, ToolResult } from '../tools/index.js'
import { buildSystemPrompt } from '../prompts/system.js'

const MAX_TURNS = 80

export interface QueryCallbacks {
  onText?: (text: string) => void
  onToolStart?: (name: string, args: string) => void
  onToolResult?: (name: string, result: ToolResult) => void
  onTurn?: (turn: number) => void
  onError?: (error: string) => void
}

// CC pattern: system prompt is prepended once, then the loop runs
export async function runQuery(
  userMessage: string,
  config: CodoConfig,
  messages: Message[],
  callbacks: QueryCallbacks = {},
): Promise<Message[]> {
  const { onText, onToolStart, onToolResult, onTurn, onError } = callbacks

  // CC pattern: inject system prompt on first message
  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: buildSystemPrompt() })
  }

  messages.push({ role: 'user', content: userMessage })

  const tools = detectProvider(config) === 'anthropic' ? toAnthropic() : toOpenAI()

  // CC pattern: tool-gated execution loop
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    onTurn?.(turn)

    // Call LLM
    let response
    try {
      response = await callLLM(messages, tools as any, config)
    } catch (ex: any) {
      onError?.(ex.message)
      break
    }

    // CC pattern: yield assistant text to UI
    if (response.content) onText?.(response.content)

    // CC pattern: if no tool_use blocks, we're done (stop condition)
    if (!response.toolCalls?.length) {
      // CC pattern: stop hooks — post-processing after final response
      messages.push({ role: 'assistant', content: response.content })
      break
    }

    // CC pattern: add assistant message with tool_calls to history
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls })

    // CC pattern: execute each tool_use block
    for (const tc of response.toolCalls) {
      onToolStart?.(tc.function.name, tc.function.arguments)

      const tool = findTool(tc.function.name)
      let result: ToolResult

      if (!tool) {
        result = { content: `Error: Unknown tool: ${tc.function.name}`, isError: true }
      } else {
        try { result = await tool.execute(JSON.parse(tc.function.arguments)) }
        catch (ex: any) { result = { content: `Error: ${ex.message}`, isError: true } }
      }

      onToolResult?.(tc.function.name, result)

      // CC pattern: add tool_result to messages for next iteration
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
    }

    // CC pattern: loop continues — the model will see tool results and decide next action
  }

  saveSession(messages)
  return messages
}

// Re-export for entry point
import { detectProvider } from '../config/index.js'
export { detectProvider }
