// ─── Approval 审批系统（参考 Codex）─────────────────────────────────────
// 工具调用前的用户确认：支持 always-ask / auto-approve-safe / full-auto
// TUI 弹出确认面板，用户选择 Yes/No/Always

import type { ToolResult } from '../tools/index.js'

export type ApprovalMode = 'always-ask' | 'auto-approve-safe' | 'full-auto'

export interface ApprovalConfig {
  mode: ApprovalMode
  // 本次会话始终允许的工具
  alwaysAllowed: Set<string>
}

export interface ApprovalRequest {
  toolName: string
  argsSummary: string
  isDestructive: boolean
  description: string
}

export type ApprovalDecision = 'yes' | 'no' | 'always'

// 需要审批的工具
const REQUIRES_APPROVAL = new Set(['write_file', 'edit_file', 'bash'])

// 安全的只读工具（不需要审批）
const SAFE_TOOLS = new Set(['read_file', 'glob', 'grep', 'fetch', 'web_search', 'todo_write', 'tool_search', 'agent'])

// 危险命令检测模式
const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-z]*f|--force|--recursive)/i,
  />\s*\/dev\//i,
  /mkfs\./i,
  /dd\s+if=/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i,
  /chmod\s+777\s/i,
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
]

let currentConfig: ApprovalConfig = {
  mode: 'auto-approve-safe',
  alwaysAllowed: new Set(),
}

export function getApprovalMode(): ApprovalMode {
  return currentConfig.mode
}

export function setApprovalMode(mode: ApprovalMode): void {
  currentConfig.mode = mode
}

export function getApprovalConfig(): ApprovalConfig {
  return currentConfig
}

/**
 * 判断工具调用是否需要审批
 * @returns null 表示不需要审批（自动允许），ApprovalRequest 表示需要用户确认
 */
export function needsApproval(toolName: string, args: Record<string, any>): ApprovalRequest | null {
  // full-auto 模式：所有工具自动执行
  if (currentConfig.mode === 'full-auto') return null

  // 安全工具：不需要审批
  if (SAFE_TOOLS.has(toolName)) return null

  // 本次会话已 always 允许
  if (currentConfig.alwaysAllowed.has(toolName)) return null

  // 不在需要审批的列表中
  if (!REQUIRES_APPROVAL.has(toolName)) return null

  // 构建审批请求
  const argsSummary = summarizeArgs(toolName, args)
  const isDestructive = checkDestructive(toolName, args)
  const description = getToolDescription(toolName)

  // auto-approve-safe 模式：非破坏性操作自动执行
  if (currentConfig.mode === 'auto-approve-safe' && !isDestructive) {
    return null
  }

  return { toolName, argsSummary, isDestructive, description }
}

/**
 * 处理审批决策
 */
export function handleApprovalDecision(
  request: ApprovalRequest,
  decision: ApprovalDecision
): { allowed: boolean; message?: string } {
  switch (decision) {
    case 'yes':
      return { allowed: true }
    case 'always':
      currentConfig.alwaysAllowed.add(request.toolName)
      return { allowed: true, message: `✅ 本次会话始终允许 ${request.toolName}` }
    case 'no':
      return { allowed: false, message: `🚫 已拒绝执行 ${request.toolName}` }
  }
}

/**
 * 检查是否是破坏性操作
 */
function checkDestructive(toolName: string, args: Record<string, any>): boolean {
  if (toolName === 'bash') {
    const cmd = args.command || ''
    return DANGEROUS_PATTERNS.some(p => p.test(cmd))
  }
  if (toolName === 'write_file') {
    // 写入已存在的文件视为破坏性
    return true
  }
  if (toolName === 'edit_file') {
    return true
  }
  return false
}

/**
 * 生成参数摘要（用于 UI 显示）
 */
function summarizeArgs(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'bash': {
      const cmd = args.command || ''
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd
    }
    case 'write_file': {
      const path = args.file_path || ''
      const lines = (args.content || '').split('\n').length
      return `${path} (${lines} lines)`
    }
    case 'edit_file': {
      const path = args.file_path || ''
      const oldLines = (args.old_string || '').split('\n').length
      const newLines = (args.new_string || '').split('\n').length
      return `${path} (${oldLines}→${newLines} lines)`
    }
    default:
      return JSON.stringify(args).slice(0, 60)
  }
}

/**
 * 获取工具的用户友好描述
 */
function getToolDescription(toolName: string): string {
  const map: Record<string, string> = {
    write_file: '写入文件',
    edit_file: '编辑文件',
    bash: '执行命令',
  }
  return map[toolName] || toolName
}

/**
 * 清除 always 允许列表（新会话时调用）
 */
export function clearAlwaysAllowed(): void {
  currentConfig.alwaysAllowed.clear()
}
