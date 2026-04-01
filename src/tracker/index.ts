// ─── 文件变更追踪 ─────────────────────────────────────────────────────
// 追踪 write_file / edit_file 操作的文件变更
// 支持 diff 显示、文件回退

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { structuredPatch } from 'diff'

export interface FileSnapshot {
  path: string
  content: string
  hash: string
  timestamp: number
}

export interface FileChange {
  path: string
  oldContent: string
  newContent: string
  oldHash: string
  newHash: string
  timestamp: number
  toolName: string
  addedLines: number
  removedLines: number
}

// 会话级变更历史
const fileChanges: Map<string, FileChange> = new Map()
// 快照：文件修改前的状态（用于 revert）
const snapshots: Map<string, FileSnapshot> = new Map()

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

/**
 * 在文件操作前记录快照
 * @param filePath 文件路径
 * @returns 快照信息
 */
export function snapshotBefore(filePath: string): FileSnapshot | null {
  try {
    const p = resolve(filePath)
    if (!existsSync(p) || !statSync(p).isFile()) return null
    const content = readFileSync(p, 'utf-8')
    const snap: FileSnapshot = {
      path: p,
      content,
      hash: hashContent(content),
      timestamp: Date.now(),
    }
    // 只保存第一次快照（用于 revert 到原始状态）
    if (!snapshots.has(p)) {
      snapshots.set(p, snap)
    }
    return snap
  } catch {
    return null
  }
}

/**
 * 在文件操作后记录变更
 * @param filePath 文件路径
 * @param toolName 工具名称
 * @param beforeSnapshot 操作前的快照
 */
export function recordChange(
  filePath: string,
  toolName: string,
  beforeSnapshot: FileSnapshot | null
): FileChange | null {
  try {
    const p = resolve(filePath)
    if (!existsSync(p)) return null
    const newContent = readFileSync(p, 'utf-8')
    const newHash = hashContent(newContent)

    const oldContent = beforeSnapshot?.content ?? ''
    const oldHash = beforeSnapshot?.hash ?? '(new file)'

    // 如果内容没变，不记录
    if (oldHash === newHash) return null

    // 计算变更行数
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const patch = structuredPatch(p, p, oldContent, newContent)
    let addedLines = 0
    let removedLines = 0
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) addedLines++
        else if (line.startsWith('-')) removedLines++
      }
    }

    const change: FileChange = {
      path: p,
      oldContent,
      newContent,
      oldHash,
      newHash,
      timestamp: Date.now(),
      toolName,
      addedLines,
      removedLines,
    }

    fileChanges.set(p, change)
    return change
  } catch {
    return null
  }
}

/**
 * 获取所有变更的文件列表
 */
export function getChangedFiles(): FileChange[] {
  return Array.from(fileChanges.values())
}

/**
 * 获取某个文件的变更信息
 */
export function getFileChange(filePath: string): FileChange | null {
  const p = resolve(filePath)
  return fileChanges.get(p) ?? null
}

/**
 * 获取文件的原始快照（用于 revert）
 */
export function getOriginalSnapshot(filePath: string): FileSnapshot | null {
  const p = resolve(filePath)
  return snapshots.get(p) ?? null
}

/**
 * 回退文件到修改前的状态
 * @param filePath 文件路径
 * @returns 是否成功
 */
export function revertFile(filePath: string): { success: boolean; message: string } {
  const p = resolve(filePath)
  const snapshot = snapshots.get(p)

  if (!snapshot) {
    return { success: false, message: `没有找到 ${filePath} 的原始快照（可能未被修改过）` }
  }

  try {
    writeFileSync(p, snapshot.content)
    fileChanges.delete(p)
    return { success: true, message: `✅ 已回退 ${filePath} 到修改前的状态` }
  } catch (ex: any) {
    return { success: false, message: `回退失败: ${ex.message}` }
  }
}

/**
 * 生成文件的 unified diff 文本
 */
export function getFileDiff(filePath: string): string {
  const change = fileChanges.get(resolve(filePath))
  if (!change) return `没有找到 ${filePath} 的变更记录`

  const patch = structuredPatch(filePath, filePath, change.oldContent, change.newContent)
  const lines: string[] = []

  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    for (const line of hunk.lines) {
      lines.push(line)
    }
  }

  return lines.join('\n')
}

/**
 * 格式化变更摘要（用于 UI 显示）
 * @returns 例如 "+15 -3 lines"
 */
export function formatChangeSummary(change: FileChange): string {
  const parts: string[] = []
  if (change.addedLines > 0) parts.push(`+${change.addedLines}`)
  if (change.removedLines > 0) parts.push(`-${change.removedLines}`)
  return parts.length > 0 ? parts.join(' ') + ' lines' : 'no changes'
}

/**
 * 清除所有追踪数据（新会话时调用）
 */
export function clearTracker(): void {
  fileChanges.clear()
  snapshots.clear()
}

/**
 * 获取变更统计
 */
export function getTrackerStats(): string {
  const changes = getChangedFiles()
  if (changes.length === 0) return '没有文件变更'

  const totalAdded = changes.reduce((s, c) => s + c.addedLines, 0)
  const totalRemoved = changes.reduce((s, c) => s + c.removedLines, 0)
  return `${changes.length} 个文件变更 (+${totalAdded} -${totalRemoved})`
}
