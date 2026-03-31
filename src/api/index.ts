// ─── Layer 5: API ─────────────────────────────────────────────────────────
import { CodoConfig, Message, ToolCall, getApiKey, detectProvider } from '../config/index.js'
export interface LLMResponse { content: string; toolCalls: ToolCall[] }

async function callOpenAI(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const key = getApiKey(config); if (!key) throw new Error('No API key')
  const base = config.baseUrl.replace(/\/$/, '')
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(base.includes('openrouter') ? { 'HTTP-Referer': 'https://github.com/longing-bot/codo', 'X-Title': 'codo' } : {}) },
    body: JSON.stringify({ model: config.model, messages, tools, max_tokens: config.maxTokens }),
  })
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json() as any; const m = d.choices?.[0]?.message ?? {}
  return { content: m.content ?? '', toolCalls: m.tool_calls ?? [] }
}

async function callAnthropic(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  const key = getApiKey(config); if (!key) throw new Error('No API key')
  const base = config.baseUrl.replace(/\/$/, '')
  const isLC = base.includes('longcat')
  let sys = ''; const chat: any[] = []
  for (const m of messages) {
    if (m.role === 'system') sys = m.content
    else if (m.role === 'tool') chat.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] })
    else if (m.role === 'assistant' && m.tool_calls?.length) {
      const c: any[] = []; if (m.content) c.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) c.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })
      chat.push({ role: 'assistant', content: c })
    } else chat.push(m)
  }
  const auth = isLC ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens, system: sys, messages: chat, tools }) })
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json() as any; let content = ''; const tc: ToolCall[] = []
  for (const b of d.content ?? []) { if (b.type === 'text') content += b.text; if (b.type === 'tool_use') tc.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }) }
  return { content, toolCalls: tc }
}

export async function callLLM(messages: Message[], tools: any[], config: CodoConfig): Promise<LLMResponse> {
  return detectProvider(config) === 'anthropic' ? callAnthropic(messages, tools, config) : callOpenAI(messages, tools, config)
}
