// ─── 自动调试（参考 Plandex）─────────────────────────────────────────────
// 工具运行失败时自动收集错误信息，反馈给 LLM 修复

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface DebugContext {
  toolName: string
  args: Record<string, any>
  error: string
  exitCode?: number
  stderr?: string
  stdout?: string
  relatedFiles: ErrorLocation[]
  attempt: number
  maxAttempts: number
}

export interface ErrorLocation {
  file: string
  line: number
  column?: number
  message: string
}

export interface DebugResult {
  shouldRetry: boolean
  fixSuggestion?: string
  context: DebugContext
}

// ─── 错误解析 ─────────────────────────────────────────────────────────
const ERROR_PATTERNS: RegExp[] = [
  // TypeScript/JavaScript errors
  /(?:^|\n)\s*(.+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g,
  /(?:^|\n)\s*(.+\.tsx?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)/g,
  // Node.js errors
  /(?:^|\n)\s*at\s+.+\((.+):(\d+):(\d+)\)/g,
  // Python errors
  /(?:^|\n)\s*File "(.+)", line (\d+)/g,
  // Go errors
  /(?:^|\n)\s*(.+\.go):(\d+):(\d+):\s*(.+)/g,
  // Rust errors
  /(?:^|\n)\s*-->\s*(.+\.rs):(\d+):(\d+)/g,
  // Generic file:line patterns
  /(?:^|\n)\s*((?:\/|\.\.?\/)?[^:\s]+\.\w+):(\d+)(?::(\d+))?\s*(.*)/g,
]

export function parseErrors(output: string): ErrorLocation[] {
  const locations: ErrorLocation[] = []
  const seen = new Set<string>()

  for (const pattern of ERROR_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1]
      const line = parseInt(match[2]) || 0
      const column = match[3] ? parseInt(match[3]) : undefined
      const message = match[4] || match[5] || ''

      // 跳过 node_modules
      if (file.includes('node_modules')) continue

      const key = `${file}:${line}`
      if (seen.has(key)) continue
      seen.add(key)

      locations.push({ file, line, column, message: message.trim() })
    }
  }

  return locations.slice(0, 10) // 最多 10 个位置
}

// ─── 错误上下文收集 ───────────────────────────────────────────────────
export function collectDebugContext(
  toolName: string,
  args: Record<string, any>,
  result: { content: string; isError: boolean },
  attempt: number = 0,
  maxAttempts: number = 3
): DebugContext | null {
  if (!result.isError) return null

  const error = result.content

  // 解析退出码
  const exitMatch = error.match(/\[exit:\s*(\d+)\]/)
  const exitCode = exitMatch ? parseInt(exitMatch[1]) : undefined

  // 解析 stderr
  const stderrMatch = error.match(/\[stderr\]\n([\s\S]*?)(?:\n\[exit|\n$)/)
  const stderr = stderrMatch ? stderrMatch[1] : undefined

  // 解析 stdout
  const stdoutMatch = error.match(/^(.*?)(?:\n\[stderr\]|\n\[exit|$)/s)
  const stdout = stdoutMatch ? stdoutMatch[1] : undefined

  // 提取错误位置
  const relatedFiles = parseErrors(error)

  // 收集相关文件的代码片段
  for (const loc of relatedFiles) {
    try {
      const filePath = resolve(loc.file)
      if (existsSync(filePath)) {
        const lines = readFileSync(filePath, 'utf-8').split('\n')
        // 获取错误行周围的代码
        const startLine = Math.max(0, loc.line - 3)
        const endLine = Math.min(lines.length, loc.line + 2)
        const snippet = lines.slice(startLine, endLine)
          .map((l, i) => `  ${startLine + i + 1}| ${l}`)
          .join('\n')
        loc.message = `${loc.message}\nCode context:\n${snippet}`
      }
    } catch {}
  }

  return {
    toolName,
    args,
    error,
    exitCode,
    stderr,
    stdout,
    relatedFiles,
    attempt,
    maxAttempts,
  }
}

// ─── 构建修复反馈消息 ────────────────────────────────────────────────
export function buildDebugFeedback(ctx: DebugContext): string {
  const lines: string[] = []

  lines.push(`⚠️ 工具执行失败（第 ${ctx.attempt + 1}/${ctx.maxAttempts} 次尝试）`)
  lines.push(`工具: ${ctx.toolName}`)

  if (ctx.exitCode !== undefined) {
    lines.push(`退出码: ${ctx.exitCode}`)
  }

  lines.push('')

  // 错误信息摘要
  const errorLines = ctx.error.split('\n').filter(l => l.trim())
  lines.push('错误信息:')
  for (const line of errorLines.slice(0, 10)) {
    lines.push(`  ${line}`)
  }
  if (errorLines.length > 10) {
    lines.push(`  ... (${errorLines.length - 10} 行更多)`)
  }

  // 错误位置
  if (ctx.relatedFiles.length > 0) {
    lines.push('')
    lines.push('错误位置:')
    for (const loc of ctx.relatedFiles.slice(0, 5)) {
      lines.push(`  ${loc.file}:${loc.line}${loc.column ? ':' + loc.column : ''}`)
      if (loc.message) {
        // 只显示第一行消息
        lines.push(`    ${loc.message.split('\n')[0]}`)
      }
    }
  }

  lines.push('')
  lines.push('请分析错误原因并修复。使用 edit_file 或 patch_file 修改相关文件。')

  return lines.join('\n')
}

// ─── 判断是否应该自动重试 ─────────────────────────────────────────────
export function shouldAutoRetry(ctx: DebugContext): DebugResult {
  // 超过最大尝试次数
  if (ctx.attempt >= ctx.maxAttempts) {
    return {
      shouldRetry: false,
      context: ctx,
      fixSuggestion: `已达到最大重试次数（${ctx.maxAttempts}）。请手动检查错误。`,
    }
  }

  // 命令未找到 — 不自动重试
  if (ctx.error.includes('command not found') || ctx.error.includes('is not recognized')) {
    return {
      shouldRetry: false,
      context: ctx,
      fixSuggestion: '命令不存在。请检查是否已安装相关工具。',
    }
  }

  // 权限错误 — 不自动重试
  if (ctx.error.includes('Permission denied') || ctx.error.includes('EACCES')) {
    return {
      shouldRetry: false,
      context: ctx,
      fixSuggestion: '权限不足。请检查文件权限。',
    }
  }

  // 其他错误 — 允许重试
  return {
    shouldRetry: true,
    context: ctx,
  }
}

// ─── 格式化调试结果 ──────────────────────────────────────────────────
export function formatDebugSummary(ctx: DebugContext): string {
  const pos = ctx.relatedFiles.slice(0, 3).map(l => `${l.file}:${l.line}`).join(', ')
  return `调试: ${ctx.toolName} 失败 (${ctx.attempt + 1}/${ctx.maxAttempts})${pos ? ` @ ${pos}` : ''}`
}
