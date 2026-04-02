// ─── Shell Hook 系统 ────────────────────────────────────────────────────
// 执行 ~/.edgecli/hooks/pre-tool-use.sh 和 post-tool-use.sh（如果存在）
// 退出码 0 = 允许，2 = 拒绝，其他 = 警告

import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

export enum HookEvent {
  PreToolUse = 'PreToolUse',
  PostToolUse = 'PostToolUse',
  Stop = 'Stop',
}

const HOOKS_DIR = join(homedir(), '.edgecli', 'hooks')

export interface ShellHookContext {
  toolName: string
  toolInput: Record<string, any>
  toolOutput?: string
  toolError?: string
}

export interface ShellHookResult {
  allowed: boolean
  message?: string
  exitCode: number
}

function ensureHooksDir() {
  mkdirSync(HOOKS_DIR, { recursive: true })
}

function getHookPath(event: HookEvent): string | null {
  const shPath = join(HOOKS_DIR, `${event === HookEvent.PreToolUse ? 'pre-tool-use' : 'post-tool-use'}.sh`)
  if (existsSync(shPath)) return shPath
  return null
}

export function executeShellHook(event: HookEvent, ctx: ShellHookContext): ShellHookResult | null {
  ensureHooksDir()
  const hookPath = getHookPath(event)
  if (!hookPath) return null

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    EDGECLI_HOOK_EVENT: event,
    EDGECLI_TOOL_NAME: ctx.toolName,
    EDGECLI_TOOL_INPUT: JSON.stringify(ctx.toolInput),
    EDGECLI_CWD: process.cwd(),
  }
  if (ctx.toolOutput !== undefined) env.EDGECLI_TOOL_OUTPUT = ctx.toolOutput
  if (ctx.toolError !== undefined) env.EDGECLI_TOOL_ERROR = ctx.toolError

  try {
    const output = execSync(`bash "${hookPath}"`, {
      env,
      timeout: 10000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    return { allowed: true, message: output || undefined, exitCode: 0 }
  } catch (ex: any) {
    const exitCode = ex.status ?? 1
    const stderr = (ex.stderr || '').trim()
    const stdout = (ex.stdout || '').trim()
    const msg = stderr || stdout || undefined

    if (exitCode === 2) {
      // 退出码 2 = 拒绝
      return { allowed: false, message: msg || `Hook 拒绝了 ${ctx.toolName}`, exitCode }
    }
    // 其他非零退出码 = 警告（不阻止执行）
    return { allowed: true, message: msg ? `⚠️ Hook 警告: ${msg}` : undefined, exitCode }
  }
}
