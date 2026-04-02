// ─── Hook 系统（CC PreToolUse/PostToolUse 风格）─────────────────────────────
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolResult } from '../tools/index.js'
import { evaluateExecution } from './policy.js'
import { executeShellHook, HookEvent as ShellHookEvent } from './system.js'

// ─── Hook 类型 ──────────────────────────────────────────────────────────
export type HookEventType = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Stop'

export interface HookInput {
  hook_event_name: HookEventType
  tool_name: string
  tool_input: Record<string, any>
  tool_output?: string
  tool_error?: string
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: HookEventType
    permissionBehavior?: 'allow' | 'deny' | 'ask'
    blockingMessage?: string
  }
}

export type HookFn = (input: HookInput) => Promise<HookOutput | null>

// ─── Hook 注册表 ───────────────────────────────────────────────────────
const preToolHooks: HookFn[] = []
const postToolHooks: HookFn[] = []
const postToolFailureHooks: HookFn[] = []
const stopHooks: HookFn[] = []

export function registerPreToolHook(hook: HookFn) { preToolHooks.push(hook) }
export function registerPostToolHook(hook: HookFn) { postToolHooks.push(hook) }
export function registerPostToolFailureHook(hook: HookFn) { postToolFailureHooks.push(hook) }
export function registerStopHook(hook: HookFn) { stopHooks.push(hook) }

// ─── PreToolUse Hooks ──────────────────────────────────────────────────
export async function executePreToolHooks(
  toolName: string,
  toolInput: Record<string, any>
): Promise<{ allowed: boolean; reason?: string }> {
  const input: HookInput = {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  }

  // 内置 hook：bash 执行策略（Codex AskForApproval 风格）
  if (toolName === 'bash') {
    const policy = evaluateExecution(toolInput.command)
    if (!policy.allowed) {
      return { allowed: false, reason: `🚫 ${policy.reason}: ${toolInput.command}` }
    }
  }

  // 内置 hook：文件验证
  if (toolName === 'edit_file') {
    const path = resolve(toolInput.file_path)
    if (!existsSync(path)) return { allowed: false, reason: `文件不存在: ${toolInput.file_path}` }
    try {
      const content = readFileSync(path, 'utf-8')
      const count = content.split(toolInput.old_string).length - 1
      if (count === 0) return { allowed: false, reason: 'old_string 未找到。文件可能已变更。' }
      if (count > 1) return { allowed: false, reason: `找到 ${count} 处匹配。需要更多上下文。` }
    } catch { return { allowed: false, reason: '无法读取文件。' } }
  }

  if (toolName === 'read_file') {
    const path = resolve(toolInput.file_path)
    if (!existsSync(path)) return { allowed: false, reason: `文件不存在: ${toolInput.file_path}` }
  }

  // 运行用户注册的 hooks
  for (const hook of preToolHooks) {
    const result = await hook(input)
    if (result?.hookSpecificOutput?.permissionBehavior === 'deny') {
      return { allowed: false, reason: result.hookSpecificOutput.blockingMessage }
    }
  }

  // 运行 shell hook（~/.edgecli/hooks/pre-tool-use.sh）
  const shellResult = executeShellHook(ShellHookEvent.PreToolUse, {
    toolName,
    toolInput,
  })
  if (shellResult && !shellResult.allowed) {
    return { allowed: false, reason: shellResult.message || `Shell hook 拒绝了 ${toolName}` }
  }
  if (shellResult?.message && shellResult.allowed) {
    // 警告信息，附加到结果但不阻止
    process.stderr.write(`\n${shellResult.message}\n`)
  }

  return { allowed: true }
}

// ─── PostToolUse Hooks ─────────────────────────────────────────────────
export async function executePostToolHooks(
  toolName: string,
  toolInput: Record<string, any>,
  result: ToolResult
): Promise<ToolResult> {
  const input: HookInput = {
    hook_event_name: result.isError ? 'PostToolUseFailure' : 'PostToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: result.content,
    tool_error: result.isError ? result.content : undefined,
  }

  // 内置 hook：错误检测
  if (!result.isError) {
    if (toolName === 'bash') {
      if (result.content.includes('command not found') || result.content.includes('No such file')) {
        return { ...result, content: `⚠️ ${result.content}` }
      }
    }
  }

  // 运行用户注册的 hooks
  for (const hook of result.isError ? postToolFailureHooks : postToolHooks) {
    const output = await hook(input)
    if (output?.hookSpecificOutput?.blockingMessage) {
      return { ...result, content: output.hookSpecificOutput.blockingMessage }
    }
  }

  // 运行 shell hook（~/.edgecli/hooks/post-tool-use.sh）
  const shellResult = executeShellHook(ShellHookEvent.PostToolUse, {
    toolName,
    toolInput,
    toolOutput: result.content,
    toolError: result.isError ? result.content : undefined,
  })
  if (shellResult?.message && !result.isError) {
    return { ...result, content: result.content + '\n' + shellResult.message }
  }

  return result
}

// ─── Stop Hooks（CC-inspired）─────────────────────────────────────────
// 当模型停止调用工具时执行。如果 hook 返回 blockingMessage，
// 注入为用户消息强制循环继续。
export interface StopHookResult {
  blockingErrors: string[]     // 注入到 messages 的错误信息
  preventContinuation: boolean // 是否阻止继续
}

export async function executeStopHooks(context: {
  messages: Array<{ role: string; content: string }>
  turnCount: number
  totalToolRounds: number
}): Promise<StopHookResult> {
  const blockingErrors: string[] = []
  let preventContinuation = false

  const input: HookInput = {
    hook_event_name: 'Stop',
    tool_name: '',
    tool_input: { turnCount: context.turnCount, totalToolRounds: context.totalToolRounds },
  }

  for (const hook of stopHooks) {
    const output = await hook(input)
    if (output?.hookSpecificOutput?.blockingMessage) {
      blockingErrors.push(output.hookSpecificOutput.blockingMessage)
    }
    if (output?.hookSpecificOutput?.permissionBehavior === 'deny') {
      preventContinuation = true
    }
  }

  // 运行 shell hook
  const shellResult = executeShellHook(ShellHookEvent.Stop, {
    toolName: '',
    toolInput: { turnCount: context.turnCount, totalToolRounds: context.totalToolRounds },
  })
  if (shellResult?.message) {
    blockingErrors.push(shellResult.message)
  }

  return { blockingErrors, preventContinuation }
}
