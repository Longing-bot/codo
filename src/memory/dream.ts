// ─── AutoDream 后台记忆整理（CC autoDream 风格）─────────────────────────────
// CC 的 autoDream 在以下条件满足时触发：
// 1. 距离上次整理超过 minHours 小时
// 2. 有 minSessions 个以上的新会话
// 3. 没有其他进程正在整理
//
// 简化版：每 5 次会话或 24 小时触发一次

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface DreamState {
  lastConsolidatedAt: number  // timestamp
  sessionCount: number        // 上次整理后的会话数
}

const MEMORY_DIR = join(homedir(), '.edgecli')
const STATE_FILE = join(MEMORY_DIR, 'dream-state.json')
const MIN_HOURS = 24
const MIN_SESSIONS = 5

function loadState(): DreamState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    } catch {}
  }
  return { lastConsolidatedAt: 0, sessionCount: 0 }
}

function saveState(state: DreamState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// 检查是否需要整理
export function shouldConsolidate(): boolean {
  const state = loadState()
  const now = Date.now()
  const hoursSince = (now - state.lastConsolidatedAt) / (1000 * 60 * 60)

  // 时间门控
  if (hoursSince < MIN_HOURS) return false

  // 会话门控
  if (state.sessionCount < MIN_SESSIONS) return false

  return true
}

// 记录新会话
export function recordSession() {
  const state = loadState()
  state.sessionCount++
  saveState(state)
}

// 整理记忆（简化版）
export async function consolidateMemory(): Promise<string> {
  const state = loadState()
  const parts: string[] = []

  // 读取所有日记文件
  const memoryDir = join(MEMORY_DIR, 'memory')
  if (existsSync(memoryDir)) {
    try {
      const files = readdirSync(memoryDir)
        .filter((f: string) => f.endsWith('.md'))
        .sort()
        .slice(-7)  // 最近 7 天

      for (const file of files) {
        const content = readFileSync(join(memoryDir, file), 'utf-8')
        if (content.trim()) {
          parts.push(`## ${file.replace('.md', '')}\n${content.slice(0, 500)}`)
        }
      }
    } catch {}
  }

  // 读取 MEMORY.md
  const memoryFile = join(MEMORY_DIR, 'MEMORY.md')
  if (existsSync(memoryFile)) {
    const content = readFileSync(memoryFile, 'utf-8')
    if (content.trim()) {
      parts.push(`## MEMORY.md\n${content.slice(0, 1000)}`)
    }
  }

  // 更新状态
  state.lastConsolidatedAt = Date.now()
  state.sessionCount = 0
  saveState(state)

  if (parts.length === 0) {
    return '没有需要整理的记忆。'
  }

  return `记忆整理完成。处理了 ${parts.length} 个记忆文件。\n\n${parts.join('\n\n---\n\n')}`
}
