// ─── Hook 系统（CC PreToolUse/PostToolUse 风格）─────────────────────────────
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolResult } from '../tools/index.js'
import { evaluateExecution } from './policy.js'

// ─── Hook 类型 ──────────────────────────────────────────────────────────
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'

export interface HookInput {
  hook_event_name: HookEvent
  tool_name: string
  tool_input: Record<string, any>
  tool_output?: string
  tool_error?: string
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: HookEvent
    permissionBehavior?: 'allow' | 'deny' | 'ask'
    blockingMessage?: string
  }
}

export type HookFn = (input: HookInput) => Promise<HookOutput | null>

// ─── Hook 注册表 ───────────────────────────────────────────────────────
const preToolHooks: HookFn[] = []
const postToolHooks: HookFn[] = []
const postToolFailureHooks: HookFn[] = []

export function registerPreToolHook(hook: HookFn) { preToolHooks.push(hook) }
export function registerPostToolHook(hook: HookFn) { postToolHooks.push(hook) }
export function registerPostToolFailureHook(hook: HookFn) { postToolFailureHooks.push(hook) }

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

  return result
}
