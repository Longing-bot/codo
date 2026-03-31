// ─── Layer 5: API ─────────────────────────────────────────────────────────
// LLM API calls - supports OpenAI, Anthropic, and OpenRouter

import { CodoConfig, Message, ToolCall, getApiKey } from '../config/index.js'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LLMResponse {
  content: string
  toolCalls: ToolCall[]
}

// Detect provider from base URL
export function detectProvider(config: CodoConfig): string {
  const url = config.baseUrl
  if (url.includes('anthropic')) return 'anthropic'
  if (url.includes('openai') && !url.includes('openrouter')) return 'openai'
  return 'openrouter'
}

// ─── OpenAI-compatible API ─────────────────────────────────────────────
async function callOpenAI(
  messages: Message[],
  tools: ToolDefinition[],
  config: CodoConfig,
): Promise<LLMResponse> {
  const apiKey = getApiKey(config)
  if (!apiKey) throw new Error('No API key. Set OPENROUTER_API_KEY or run: codo --config')

  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const payload = {
    model: config.model,
    messages,
    tools,
    max_tokens: config.maxTokens,
    stream: false,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  if (baseUrl.includes('openrouter')) {
    headers['HTTP-Referer'] = 'https://github.com/longing-bot/codo'
    headers['X-Title'] = 'codo'
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API Error ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json() as any
  const msg = data.choices?.[0]?.message ?? {}

  return {
    content: msg.content ?? '',
    toolCalls: msg.tool_calls ?? [],
  }
}

// ─── Anthropic API ─────────────────────────────────────────────────────
async function callAnthropic(
  messages: Message[],
  tools: AnthropicTool[],
  config: CodoConfig,
): Promise<LLMResponse> {
  const apiKey = getApiKey(config)
  if (!apiKey) throw new Error('No API key. Set ANTHROPIC_API_KEY')

  // Convert messages to Anthropic format
  let systemMsg = ''
  const chatMessages: any[] = []

  for (const m of messages) {
    if (m.role === 'system') {
      systemMsg = m.content
    } else if (m.role === 'tool') {
      chatMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
      })
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: any[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })
      }
      chatMessages.push({ role: 'assistant', content })
    } else {
      chatMessages.push(m)
    }
  }

  const payload = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemMsg,
    messages: chatMessages,
    tools,
  }

  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const isLongCat = baseUrl.includes('longcat')
  const authHeaders: Record<string, string> = isLongCat
    ? { 'Authorization': `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic Error ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json() as any
  let content = ''
  const toolCalls: ToolCall[] = []

  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      })
    }
  }

  return { content, toolCalls }
}

// ─── Universal call ────────────────────────────────────────────────────
export async function callLLM(
  messages: Message[],
  tools: ToolDefinition[] | AnthropicTool[],
  config: CodoConfig,
): Promise<LLMResponse> {
  const provider = detectProvider(config)
  if (provider === 'anthropic') {
    return callAnthropic(messages, tools as AnthropicTool[], config)
  }
  return callOpenAI(messages, tools as ToolDefinition[], config)
}
