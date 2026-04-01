// ─── Git 深度集成（参考 Aider）────────────────────────────────────────────
// 自动 commit、/commit、/branch、/undo、/diff-git、merge conflict 检测

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface GitStatus {
  isRepo: boolean
  branch: string
  staged: string[]
  modified: string[]
  untracked: string[]
  conflicted: string[]
  ahead: number
  behind: number
  lastCommit: string
}

export interface CommitResult {
  success: boolean
  hash?: string
  message: string
}

export interface AICommitInfo {
  files: string[]
  summary: string
}

// ─── 工具函数 ──────────────────────────────────────────────────────────
function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000, cwd: cwd || process.cwd() }).trim()
  } catch {
    return ''
  }
}

function runOrThrow(cmd: string, cwd?: string): string {
  return execSync(cmd, { encoding: 'utf-8', timeout: 10000, cwd: cwd || process.cwd() }).trim()
}

export function isGitRepo(cwd?: string): boolean {
  return !!run('git rev-parse --is-inside-work-tree', cwd)
}

export function getGitRoot(cwd?: string): string {
  return run('git rev-parse --show-toplevel', cwd) || process.cwd()
}

// ─── Git Status ───────────────────────────────────────────────────────
export function getGitStatus(): GitStatus {
  const cwd = process.cwd()
  if (!isGitRepo(cwd)) {
    return {
      isRepo: false, branch: '', staged: [], modified: [],
      untracked: [], conflicted: [], ahead: 0, behind: 0, lastCommit: '',
    }
  }

  const branch = run('git branch --show-current', cwd)
  const lastCommit = run('git log --oneline -1', cwd)

  // staged files
  const stagedRaw = run('git diff --cached --name-only', cwd)
  const staged = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : []

  // modified (unstaged)
  const modifiedRaw = run('git diff --name-only', cwd)
  const modified = modifiedRaw ? modifiedRaw.split('\n').filter(Boolean) : []

  // untracked
  const untrackedRaw = run('git ls-files --others --exclude-standard', cwd)
  const untracked = untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : []

  // conflicted (merge conflicts)
  const conflictedRaw = run('git diff --name-only --diff-filter=U', cwd)
  const conflicted = conflictedRaw ? conflictedRaw.split('\n').filter(Boolean) : []

  // ahead/behind
  let ahead = 0, behind = 0
  const tracking = run(`git rev-list --left-right --count HEAD...@{upstream}`, cwd)
  if (tracking) {
    const parts = tracking.split(/\s+/)
    if (parts.length === 2) {
      ahead = parseInt(parts[0]) || 0
      behind = parseInt(parts[1]) || 0
    }
  }

  return { isRepo: true, branch, staged, modified, untracked, conflicted, ahead, behind, lastCommit }
}

// ─── 自动 Stage ───────────────────────────────────────────────────────
export function stageFile(filePath: string): boolean {
  try {
    runOrThrow(`git add "${filePath}"`)
    return true
  } catch {
    return false
  }
}

export function stageFiles(filePaths: string[]): number {
  let count = 0
  for (const f of filePaths) {
    if (stageFile(f)) count++
  }
  return count
}

// ─── AI 生成 Commit Message ───────────────────────────────────────────
export function generateCommitMessage(files: string[], diffSummary?: string): string {
  const status = getGitStatus()
  if (!status.isRepo) return 'chore: update files'

  // 获取 diff 统计
  const diff = diffSummary || run('git diff --cached --stat')

  // 根据变更类型推断 commit type
  const allNew = files.every(f => run(`git log --oneline -1 -- "${f}"`) === '')
  const hasTestChanges = files.some(f => f.includes('test') || f.includes('spec') || f.includes('__test'))
  const hasConfigChanges = files.some(f =>
    f.includes('config') || f.endsWith('.json') || f.endsWith('.yml') || f.endsWith('.yaml')
  )
  const hasDocChanges = files.some(f =>
    f.endsWith('.md') || f.endsWith('.txt') || f.includes('doc')
  )

  // 获取实际 diff 内容用于分析
  const diffContent = run('git diff --cached --stat')
  const changeLines = diffContent.split('\n').filter(Boolean)

  // 推断 type
  let type = 'chore'
  if (allNew && files.some(f => f.includes('src/'))) type = 'feat'
  else if (hasTestChanges && !files.some(f => f.includes('src/'))) type = 'test'
  else if (hasDocChanges && !files.some(f => f.includes('src/'))) type = 'docs'
  else if (hasConfigChanges) type = 'chore'
  else {
    // 检查是否是修复
    const lastMsg = run('git log --oneline -1')
    if (lastMsg.includes('feat') || lastMsg.includes('add')) type = 'refactor'
    else type = 'fix'
  }

  // 推断 scope
  const scopes = new Set<string>()
  for (const f of files) {
    const parts = f.split('/')
    if (parts.length > 1 && parts[0] !== 'src') scopes.add(parts[0])
    else if (parts.length > 2) scopes.add(parts[1])
  }
  const scope = scopes.size === 1 ? Array.from(scopes)[0] : ''

  // 生成 subject
  const fileNames = files.map(f => f.split('/').pop() || f).join(', ')
  const subject = allNew ? `add ${fileNames}` : `update ${fileNames}`

  const scopeStr = scope ? `(${scope})` : ''
  return `${type}${scopeStr}: ${subject}`
}

// ─── Commit ───────────────────────────────────────────────────────────
export function commitStaged(message: string): CommitResult {
  if (!isGitRepo()) return { success: false, message: '当前目录不是 git 仓库' }

  const staged = run('git diff --cached --name-only')
  if (!staged) return { success: false, message: '没有已 staged 的文件。先修改文件或手动 git add。' }

  try {
    runOrThrow(`git commit -m ${JSON.stringify(message)}`)
    const hash = run('git rev-parse --short HEAD')
    return { success: true, hash, message: `✅ 已提交: ${hash} ${message}` }
  } catch (ex: any) {
    return { success: false, message: `提交失败: ${ex.message}` }
  }
}

export function autoCommit(files: string[]): CommitResult {
  if (!isGitRepo()) return { success: false, message: '' }
  if (files.length === 0) return { success: false, message: '' }

  // stage 文件
  const staged = stageFiles(files)
  if (staged === 0) return { success: false, message: '' }

  // 生成 commit message
  const message = generateCommitMessage(files)
  return commitStaged(message)
}

// ─── Branch ───────────────────────────────────────────────────────────
export function createBranch(name: string): { success: boolean; message: string } {
  if (!isGitRepo()) return { success: false, message: '当前目录不是 git 仓库' }

  // 检查是否有未提交的变更
  const status = getGitStatus()
  if (status.staged.length > 0 || status.modified.length > 0) {
    return { success: false, message: '有未提交的变更。请先 commit 或 stash。' }
  }

  try {
    runOrThrow(`git checkout -b "${name}"`)
    return { success: true, message: `✅ 已创建并切换到分支: ${name}` }
  } catch (ex: any) {
    return { success: false, message: `创建分支失败: ${ex.message}` }
  }
}

export function switchBranch(name: string): { success: boolean; message: string } {
  if (!isGitRepo()) return { success: false, message: '当前目录不是 git 仓库' }

  try {
    runOrThrow(`git checkout "${name}"`)
    return { success: true, message: `✅ 已切换到分支: ${name}` }
  } catch (ex: any) {
    return { success: false, message: `切换分支失败: ${ex.message}` }
  }
}

export function listBranches(): string[] {
  const raw = run('git branch --format="%(refname:short)"')
  return raw ? raw.split('\n').filter(Boolean) : []
}

// ─── Undo（撤销上一次 AI commit）────────────────────────────────────
// 追踪 AI 产生的 commit hash
const aiCommitHashes: string[] = []

export function trackAICommit(hash?: string) {
  if (hash) aiCommitHashes.push(hash)
}

export function undoLastCommit(): { success: boolean; message: string } {
  if (!isGitRepo()) return { success: false, message: '当前目录不是 git 仓库' }

  const lastCommit = run('git rev-parse --short HEAD')
  if (!lastCommit) return { success: false, message: '没有可撤销的提交。' }

  try {
    // soft reset（保留工作区改动）
    runOrThrow('git reset --soft HEAD~1')
    // 移除追踪
    const idx = aiCommitHashes.indexOf(lastCommit)
    if (idx !== -1) aiCommitHashes.splice(idx, 1)
    return { success: true, message: `✅ 已撤销提交 ${lastCommit}（工作区改动已保留）` }
  } catch (ex: any) {
    return { success: false, message: `撤销失败: ${ex.message}` }
  }
}

// ─── Diff ─────────────────────────────────────────────────────────────
export function getGitDiff(cached: boolean = false): string {
  if (!isGitRepo()) return '当前目录不是 git 仓库'
  const flag = cached ? '--cached' : ''
  const diff = run(`git diff ${flag}`)
  if (!diff) return cached ? '没有已 staged 的变更' : '没有未暂存的变更'
  return diff
}

export function getGitDiffStat(): string {
  if (!isGitRepo()) return '当前目录不是 git 仓库'
  const stat = run('git diff --stat')
  if (!stat) return '没有变更'
  return stat
}

// ─── Merge Conflict 检测 ─────────────────────────────────────────────
export function detectConflicts(): { hasConflicts: boolean; files: string[] } {
  if (!isGitRepo()) return { hasConflicts: false, files: [] }
  const raw = run('git diff --name-only --diff-filter=U')
  const files = raw ? raw.split('\n').filter(Boolean) : []
  return { hasConflicts: files.length > 0, files }
}

export function formatConflictWarning(files: string[]): string {
  if (files.length === 0) return ''
  const lines = ['⚠️ 检测到 Merge Conflict:']
  for (const f of files) {
    lines.push(`  ${f}`)
  }
  lines.push('\n解决冲突后运行:')
  lines.push('  git add <file> && git commit')
  return lines.join('\n')
}

// ─── 格式化 Git 信息 ─────────────────────────────────────────────────
export function formatGitStatus(status: GitStatus): string {
  if (!status.isRepo) return '(not a git repo)'

  const lines = [`Git: ${status.branch}`]

  if (status.lastCommit) {
    lines.push(`  Last: ${status.lastCommit}`)
  }

  if (status.staged.length > 0) {
    lines.push(`  Staged: ${status.staged.slice(0, 5).join(', ')}${status.staged.length > 5 ? ` (+${status.staged.length - 5})` : ''}`)
  }
  if (status.modified.length > 0) {
    lines.push(`  Modified: ${status.modified.slice(0, 5).join(', ')}${status.modified.length > 5 ? ` (+${status.modified.length - 5})` : ''}`)
  }
  if (status.untracked.length > 0) {
    lines.push(`  Untracked: ${status.untracked.length} files`)
  }
  if (status.conflicted.length > 0) {
    lines.push(`  ⚠️ Conflicted: ${status.conflicted.join(', ')}`)
  }
  if (status.ahead > 0 || status.behind > 0) {
    lines.push(`  ↑${status.ahead} ↓${status.behind}`)
  }

  return lines.join('\n')
}
