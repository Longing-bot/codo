// ─── Global Memory Extraction（extractMemories）────────────────────────────
// 从对话历史中提取长期记忆，补充到结构化存储，供后续上下文增强。
// CC 风格：异步 fire-and-forget，不阻塞主循环。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Message } from '../config/index.js'
import { estimateMessageTokens } from './index.js'

// ─── 配置 ──────────────────────────────────────────────────────────────
interface ExtractMemoriesConfig {
  // 触发间隔（小时）
  intervalHours: number
  // 会话数阈值（完成的任务数）
  sessionThreshold: number
  // 分析的消息数量（最近 N 条）
  recentMessageCount: number
  // 最小置信度
  minConfidence: number
  // 去重阈值（相似度 > 此值则合并）
  deduplicationThreshold: number
  // 存储路径
  storagePath: string
  // 是否启用
  enabled: boolean
}

const DEFAULT_CONFIG: ExtractMemoriesConfig = {
  intervalHours: 24,
  sessionThreshold: 5,
  recentMessageCount: 50,
  minConfidence: 0.6,
  deduplicationThreshold: 0.9,
  storagePath: join(homedir(), '.edgecli', 'memory', 'long-term.json'),
  enabled: true,
}

// ─── 状态 ──────────────────────────────────────────────────────────────
interface ExtractionState {
  lastExtraction: number // timestamp
  completedSessions: number // since last extraction
}

const STATE_FILE = join(homedir(), '.edgecli', 'memory', 'extraction-state.json')

function loadState(): ExtractionState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    } catch {
      // fallthrough
    }
  }
  return { lastExtraction: 0, completedSessions: 0 }
}

function saveState(state: ExtractionState) {
  const dir = join(homedir(), '.edgecli', 'memory')
  mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function resetState() {
  saveState({ lastExtraction: 0, completedSessions: 0 })
}

// ─── 记忆结构 ──────────────────────────────────────────────────────────
export interface ExtractedMemory {
  id: string
  type: 'fact' | 'preference' | 'task_result' | 'error_pattern'
  content: string
  confidence: number
  source: { messageId?: string; turn?: number }
  created: number
  lastUsed?: number
  usageCount?: number
}

interface LongTermStore {
  version: string
  updated: number
  memories: ExtractedMemory[]
}

// ─── 触发条件检查 ──────────────────────────────────────────────────────
export function shouldExtractGlobalMemories(taskCompletions: number = 0): boolean {
  const config = getConfig()
  if (!config.enabled) return false

  const state = loadState()
  const now = Date.now()
  const hoursSinceLast = (now - state.lastExtraction) / (1000 * 60 * 60)

  const timeTriggered = hoursSinceLast >= config.intervalHours
  const sessionTriggered = state.completedSessions >= config.sessionThreshold

  if (timeTriggered || sessionTriggered) {
    // 触发后重置状态
    state.lastExtraction = now
    state.completedSessions = 0
    saveState(state)
    return true
  }

  // 累计完成任务数
  if (taskCompletions > 0) {
    state.completedSessions += taskCompletions
    saveState(state)
  }

  return false
}

// ─── 提取 Prompt ───────────────────────────────────────────────────────
const EXTRACTION_SYSTEM_PROMPT = `你是一个长期记忆提取器。分析以下对话历史，提取结构化信息。

输出格式（JSON 数组）：
[
  {
    "type": "fact|preference|task_result|error_pattern",
    "content": "简洁描述",
    "confidence": 0.0-1.0,
    "source_message_id": "可选的消息ID"
  }
]

提取标准：
- fact: 用户提到的客观事实（如"我用 Windows"、"项目在 ~/code"）
- preference: 用户明确表达的偏好（如"不要用 markdown 表"、"简短回复"）
- task_result: 任务完成的关键结果（如"edgecli 已优化，速度提升 30%"）
- error_pattern: 反复出现的错误或问题（如"权限提升失败"、"网络超时"）

要求：
- confidence: 提取把握度，低于 0.6 请勿输出
- content: 务必定性化、可操作，避免模糊
- 只输出 JSON，不要解释、不要 markdown 代码块

只输出 JSON 数组，没有其他内容。`

// ─── LLM 调用（注入）───────────────────────────────────────────────────
// 注意：这里需要访问 callLLM，我们通过包装函数由外部传入
type CallLLM = (messages: Message[]) => Promise<string>

// ─── 存储与去重 ────────────────────────────────────────────────────────
function getStorePath(): string {
  const config = getConfig()
  return config.storagePath
}

function loadStore(): LongTermStore {
  const path = getStorePath()
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      // fallthrough
    }
  }
  return { version: '1.0', updated: Date.now(), memories: [] }
}

function saveStore(store: LongTermStore) {
  const path = getStorePath()
  const dir = join(homedir(), '.edgecli', 'memory')
  mkdirSync(dir, { recursive: true })
  store.updated = Date.now()
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8')
}

// 简单文本相似度（基于词重叠）
function similarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return union.size ? intersection.size / union.size : 0
}

// 去重合并：如果新记忆与现有记忆相似度超过阈值，则跳过或合并
function deduplicateAndStore(newMemories: ExtractedMemory[]): number {
  const store = loadStore()
  let added = 0

  for (const nm of newMemories) {
    // 检查是否与现有记忆高度相似
    let isDuplicate = false
    for (const existing of store.memories) {
      if (nm.type === existing.type && similarity(nm.content, existing.content) >= getConfig().deduplicationThreshold) {
        isDuplicate = true
        // 更新使用统计
        existing.lastUsed = Date.now()
        existing.usageCount = (existing.usageCount || 0) + 1
        break
      }
    }

    if (!isDuplicate) {
      // 生成唯一 ID
      nm.id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      nm.lastUsed = Date.now()
      nm.usageCount = 1
      store.memories.push(nm)
      added++
    }
  }

  if (added > 0) {
    saveStore(store)
  }

  return added
}

// ─── 核心提取函数 ──────────────────────────────────────────────────────
export async function extractGlobalMemories(
  messages: Message[],
  callLLM: CallLLM
): Promise<{ success: boolean; added: number; memories: ExtractedMemory[] }> {
  const config = getConfig()
  if (!config.enabled) return { success: true, added: 0, memories: [] }

  // 取最近消息
  const recent = messages.slice(-config.recentMessageCount)
  if (recent.length === 0) return { success: true, added: 0, memories: [] }

  // 构建对话文本（简化）
  const conversation = recent.map(m => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : (m.role === 'tool' ? 'Tool' : 'System')
    return `${role}: ${m.content?.slice(0, 500) || ''}`
  }).join('\n')

  const prompt = `${EXTRACTION_SYSTEM_PROMPT}\n\n## 对话\n${conversation}`

  try {
    const response = await callLLM([{ role: 'user', content: prompt }])

    // 清理可能的 markdown 代码块
    let jsonText = response.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/```$/, '').trim()
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/```$/, '').trim()
    }

    const parsed = JSON.parse(jsonText) as Array<{ type: string; content: string; confidence: number; source_message_id?: string }>

    // 过滤并转换
    const validMemories: ExtractedMemory[] = []
    for (const p of parsed) {
      if (!p.type || !p.content || typeof p.confidence !== 'number') continue
      if (p.confidence < config.minConfidence) continue

      // 限制类型
      if (!['fact', 'preference', 'task_result', 'error_pattern'].includes(p.type)) continue

      validMemories.push({
        id: '', // 稍后生成
        type: p.type as any,
        content: p.content.slice(0, 500), // 长度限制
        confidence: p.confidence,
        source: { messageId: p.source_message_id },
        created: Date.now(),
      })
    }

    // 去重存储
    const added = deduplicateAndStore(validMemories)

    return { success: true, added, memories: validMemories }
  } catch (error) {
    console.error('[extractMemories] 提取失败:', error instanceof Error ? error.message : String(error))
    return { success: false, added: 0, memories: [] }
  }
}

// ─── 检索相关记忆（用于上下文注入）────────────────────────────────────
export function searchMemories(query: string, limit: number = 5): ExtractedMemory[] {
  const store = loadStore()
  const results: Array<ExtractedMemory & { score: number }> = []

  // 简单关键词 + 相似度评分
  const queryLower = query.toLowerCase()
  for (const mem of store.memories) {
    // 关键词命中
    const keywords = queryLower.split(/\s+/).filter(Boolean)
    const contentLower = mem.content.toLowerCase()
    const hits = keywords.filter(k => contentLower.includes(k)).length
    const keywordScore = keywords.length ? hits / keywords.length : 0

    // 字符串相似度
    const sim = similarity(query, mem.content)

    // 综合评分：关键词优先 + 类型加成
    let score = (keywordScore * 0.6 + sim * 0.4)
    if (mem.type === 'preference' && queryLower.includes('偏好') || queryLower.includes('喜欢') || queryLower.includes('不要')) {
      score += 0.2
    }
    if (mem.usageCount && mem.usageCount > 2) score += 0.1

    if (score > 0.2) {
      results.push({ ...mem, score })
    }
  }

  // 排序并限制
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit).map(r => ({ id: r.id, type: r.type, content: r.content, confidence: r.confidence, source: r.source, created: r.created, lastUsed: r.lastUsed, usageCount: r.usageCount }))
}

// ─── 加载记忆块（用于注入 system prompt）──────────────────────────────
export function loadGlobalMemories(limit: number = 3): string | null {
  const store = loadStore()
  if (store.memories.length === 0) return null

  // 取最近使用的或最新的
  const recent = store.memories
    .map(m => ({ ...m, lastUsedMs: m.lastUsed || 0 }))
    .sort((a, b) => b.lastUsedMs - a.lastUsedMs) // 优先最近使用
    .slice(0, limit)

  if (recent.length === 0) return null

  const lines = recent.map(m => `[${m.type}] ${m.content}`)
  return `## 长期记忆\n${lines.join('\n')}`
}

// ─── 配置管理（简化）────────────────────────────────────────────────────
function getConfig(): ExtractMemoriesConfig {
  // TODO: 从配置文件读取
  return { ...DEFAULT_CONFIG }
}

// ─── 调试导出 ──────────────────────────────────────────────────────────
export function getGlobalMemoryState() {
  const store = loadStore()
  const memCount = store.memories.length
  const lastExtraction = loadState().lastExtraction
  return { memCount, lastExtraction, storagePath: getStorePath() }
}
