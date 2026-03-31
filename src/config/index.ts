// ─── Layer 6: Config, Memory, Environment ──────────────────────────────────
// CC pattern: environment info auto-injected, memory files loaded, session persisted

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

export interface CodoConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  provider: 'openai' | 'anthropic' | 'openrouter'
  autoApprove: boolean
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const DIR = join(homedir(), '.edgecli')
const CONFIG_FILE = join(DIR, 'config.json')
const HISTORY_DIR = join(DIR, 'history')
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', '.edgecli.md', 'OpenCode.md']

const DEFAULT: CodoConfig = {
  apiKey: '', baseUrl: 'https://api.longcat.chat/anthropic',
  model: 'LongCat-Flash-Thinking-2601', maxTokens: 8192,
  provider: 'anthropic', autoApprove: false,
}

export function loadConfig(): CodoConfig {
  mkdirSync(DIR, { recursive: true })
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
      return { ...DEFAULT, ...raw }
    } catch (_e) {
      // ignore parse errors
    }
  }
  return { ...DEFAULT }
}
export function saveConfig(c: CodoConfig) { mkdirSync(DIR, { recursive: true }); writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)) }
export function getApiKey(c: CodoConfig): string {
  return c.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || ''
}
export function hasApiKey(c: CodoConfig): boolean {
  return !!(c.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY)
}
export function detectProvider(c: CodoConfig): string {
  if (c.provider) return c.provider
  if (c.baseUrl.endsWith('/v1') || c.baseUrl.includes('/v1/')) return 'openai'
  return 'anthropic'
}

// ─── Environment (CC pattern) ─────────────────────────────────────────
export function getEnvInfo(): string {
  const cwd = process.cwd()
  let branch = '', status = '', log = ''
  try { branch = execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim() } catch (_e) {}
  try { status = execSync('git status --short', { encoding: 'utf-8', timeout: 3000 }).trim().slice(0, 300) } catch (_e) {}
  try { log = execSync('git log --oneline -5', { encoding: 'utf-8', timeout: 3000 }).trim() } catch (_e) {}
  let tree = ''
  try {
    tree = readdirSync(cwd).filter(e => e !== '.git' && e !== 'node_modules').sort().slice(0, 40)
      .map(e => { try { return statSync(join(cwd, e)).isDirectory() ? '{1F4C1} ' + e : '{1F4C4} ' + e } catch(_e) { return '' } })
      .filter(Boolean).join('\n')
  } catch (_e) {}

  return `<environment>
Working directory: ${cwd}
Platform: ${process.platform}
Node: ${process.version}
Date: ${new Date().toISOString().split('T')[0]}
Git branch: ${branch || 'not a git repo'}
Git status: ${status || 'clean or not a git repo'}
Last commits:
${log || 'none'}
</environment>

<project_files>
${tree}
</project_files>`
}

// ─── Memory (CC pattern: auto-load CLAUDE.md etc.) ────────────────────
export function loadMemory(): string {
  const cwd = process.cwd()
  const parts: string[] = []
  for (const name of MEMORY_FILES) {
    const p = join(cwd, name)
    if (existsSync(p) && statSync(p).size < 10000) {
      try { parts.push(`<memory_file path="${name}">\n${readFileSync(p, 'utf-8')}\n</memory_file>`) } catch (_e) {}
    }
  }
  return parts.join('\n\n')
}

// ─── Session ───────────────────────────────────────────────────────────
export function getSessionFile(): string {
  mkdirSync(HISTORY_DIR, { recursive: true })
  return join(HISTORY_DIR, createHash('md5').update(process.cwd()).digest('hex').slice(0, 12) + '.json')
}
export function loadSession(): Message[] {
  const f = getSessionFile()
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, "utf-8")) } catch(_e) {} }
  return []
}
export function saveSession(msgs: Message[]) { writeFileSync(getSessionFile(), JSON.stringify(msgs.slice(-40), null, 2)) }
