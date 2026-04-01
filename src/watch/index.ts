// ─── Watch 模式（参考 Aider）────────────────────────────────────────────
// 监控文件变更，自动触发 LLM 处理

import { existsSync, statSync } from 'fs'
import { resolve, relative } from 'path'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface WatchEntry {
  id: string
  pattern: string
  enabled: boolean
  createdAt: number
  lastTriggered?: number
  changeCount: number
}

export interface FileChangeEvent {
  path: string
  type: 'add' | 'change' | 'unlink'
  timestamp: number
}

export type WatchHandler = (event: FileChangeEvent, entry: WatchEntry) => void | Promise<void>

// ─── Watch 管理 ──────────────────────────────────────────────────────
const watchEntries: Map<string, WatchEntry> = new Map()
const handlers: WatchHandler[] = []
let watcher: any = null
let watcherRefCount = 0

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 简单的 glob 转 regex
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.__GLOBSTAR__.')
    .replace(/\*/g, '[^/]*')
    .replace(/\.__GLOBSTAR__\./g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function matchesPattern(filePath: string, pattern: string): boolean {
  // 支持多种格式
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    // regex 模式
    try {
      return new RegExp(pattern.slice(1, -1)).test(filePath)
    } catch { return false }
  }

  // glob 模式
  const regex = globToRegex(pattern)
  return regex.test(filePath) || regex.test(relative(process.cwd(), filePath))
}

// ─── Watcher 初始化（使用 chokidar 如果可用，否则用 fs.watch）────────
async function ensureWatcher(): Promise<void> {
  if (watcher) return

  try {
    // 尝试使用 chokidar
    const chokidar = await import('chokidar')
    watcher = chokidar.watch('.', {
      ignored: /(^|[\/\\])\.(git|edgecli)|(node_modules|dist|build)/,
      persistent: true,
      ignoreInitial: true,
      cwd: process.cwd(),
    })

    watcher.on('all', (event: string, path: string) => {
      const type: FileChangeEvent['type'] =
        event === 'add' ? 'add' :
        event === 'unlink' ? 'unlink' : 'change'

      dispatchChange({
        path: resolve(path),
        type,
        timestamp: Date.now(),
      })
    })

    process.stderr.write('📁 文件监控已启动（chokidar）\n')
  } catch {
    // fallback: 使用 Node.js fs.watch（递归模式需要 Node 18+）
    const { watch } = await import('fs')
    try {
      watcher = watch(process.cwd(), { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const filePath = resolve(process.cwd(), String(filename))
        dispatchChange({
          path: filePath,
          type: eventType === 'rename' ? 'unlink' : 'change',
          timestamp: Date.now(),
        })
      })
      process.stderr.write('📁 文件监控已启动（fs.watch）\n')
    } catch (ex: any) {
      process.stderr.write(`⚠️ 文件监控启动失败: ${ex.message}\n`)
    }
  }
}

function dispatchChange(event: FileChangeEvent): void {
  for (const [_, entry] of watchEntries) {
    if (!entry.enabled) continue

    const relPath = relative(process.cwd(), event.path)
    if (matchesPattern(relPath, entry.pattern) || matchesPattern(event.path, entry.pattern)) {
      entry.lastTriggered = event.timestamp
      entry.changeCount++

      for (const handler of handlers) {
        try {
          handler(event, entry)
        } catch {}
      }
    }
  }
}

// ─── API ──────────────────────────────────────────────────────────────
export function addWatch(pattern: string): WatchEntry {
  const entry: WatchEntry = {
    id: generateId(),
    pattern,
    enabled: true,
    createdAt: Date.now(),
    changeCount: 0,
  }
  watchEntries.set(entry.id, entry)
  return entry
}

export function removeWatch(id: string): boolean {
  return watchEntries.delete(id)
}

export function listWatch(): WatchEntry[] {
  return Array.from(watchEntries.values())
}

export function getWatch(id: string): WatchEntry | undefined {
  return watchEntries.get(id)
}

export function enableWatch(id: string): boolean {
  const entry = watchEntries.get(id)
  if (!entry) return false
  entry.enabled = true
  return true
}

export function disableWatch(id: string): boolean {
  const entry = watchEntries.get(id)
  if (!entry) return false
  entry.enabled = false
  return true
}

export function clearWatch(): void {
  watchEntries.clear()
}

export function onFileChange(handler: WatchHandler): void {
  handlers.push(handler)
}

export async function startWatcher(): Promise<void> {
  watcherRefCount++
  if (watcherRefCount === 1) {
    await ensureWatcher()
  }
}

export function stopWatcher(): void {
  watcherRefCount = Math.max(0, watcherRefCount - 1)
  if (watcherRefCount === 0 && watcher) {
    if (typeof watcher.close === 'function') {
      watcher.close()
    } else if (typeof watcher === 'object' && 'close' in watcher) {
      (watcher as any).close()
    }
    watcher = null
  }
}

// ─── 格式化 ──────────────────────────────────────────────────────────
export function formatWatchList(entries: WatchEntry[]): string {
  if (entries.length === 0) return '没有 watch 规则。用 /watch add <pattern> 添加。'

  const lines = ['Watch 规则:\n']
  for (const entry of entries) {
    const status = entry.enabled ? '✅' : '⏸️'
    const last = entry.lastTriggered
      ? new Date(entry.lastTriggered).toLocaleTimeString()
      : '从未触发'
    lines.push(`  ${status} [${entry.id}] ${entry.pattern}`)
    lines.push(`     最后触发: ${last}  变更次数: ${entry.changeCount}`)
  }
  return lines.join('\n')
}
