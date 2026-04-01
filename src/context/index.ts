// ─── 上下文感知增强 ─────────────────────────────────────────────────────
// 自动收集 git 信息、目录结构、修改文件等上下文
// 每轮 agent loop 开始时刷新

import { execSync } from 'child_process'
import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

export interface ProjectContext {
  gitBranch: string
  recentCommits: string[]
  directoryTree: string[]
  modifiedFiles: string[]
  unstagedFiles: string[]
  isGitRepo: boolean
  cwd: string
  platform: string
  nodeVersion: string
  timestamp: number
}

// 缓存：避免每轮都重新收集（最多 5 秒内复用）
let cachedContext: ProjectContext | null = null
let lastCacheTime = 0
const CACHE_TTL_MS = 5000

/**
 * 收集当前项目的上下文信息
 * @param force 强制刷新缓存
 */
export function collectContext(force = false): ProjectContext {
  const now = Date.now()
  if (!force && cachedContext && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedContext
  }

  const cwd = process.cwd()
  let gitBranch = ''
  let recentCommits: string[] = []
  let modifiedFiles: string[] = []
  let unstagedFiles: string[] = []
  let isGitRepo = false

  // Git 分支
  try {
    gitBranch = execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim()
    isGitRepo = true
  } catch {}

  // 最近 5 条 commit
  if (isGitRepo) {
    try {
      const log = execSync('git log --oneline -5', { encoding: 'utf-8', timeout: 3000 }).trim()
      recentCommits = log ? log.split('\n') : []
    } catch {}
  }

  // Git 修改的文件
  if (isGitRepo) {
    try {
      const status = execSync('git status --short', { encoding: 'utf-8', timeout: 3000 }).trim()
      if (status) {
        const lines = status.split('\n')
        for (const line of lines) {
          const indicator = line.slice(0, 2).trim()
          const file = line.slice(3)
          if (indicator === 'M' || indicator === 'MM') {
            modifiedFiles.push(file)
          } else if (indicator === '??') {
            unstagedFiles.push(file)
          } else {
            modifiedFiles.push(file)
          }
        }
      }
    } catch {}
  }

  // 目录结构（前 30 个文件）
  let directoryTree: string[] = []
  try {
    const entries = readdirSync(cwd)
      .filter((e: string) => e !== '.git' && e !== 'node_modules' && e !== 'dist')
      .sort()
      .slice(0, 30)
    directoryTree = entries.map((e: string) => {
      try {
        return statSync(join(cwd, e)).isDirectory() ? `📁 ${e}/` : `📄 ${e}`
      } catch {
        return `📄 ${e}`
      }
    })
  } catch {}

  cachedContext = {
    gitBranch,
    recentCommits,
    directoryTree,
    modifiedFiles,
    unstagedFiles,
    isGitRepo,
    cwd,
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: now,
  }
  lastCacheTime = now
  return cachedContext
}

/**
 * 格式化上下文信息为 system prompt 的一部分
 */
export function formatContextForPrompt(ctx: ProjectContext): string {
  const parts: string[] = []

  parts.push(`<environment>`)
  parts.push(`Working directory: ${ctx.cwd}`)
  parts.push(`Platform: ${ctx.platform}`)
  parts.push(`Node: ${ctx.nodeVersion}`)
  parts.push(`Date: ${new Date().toISOString().split('T')[0]}`)

  if (ctx.isGitRepo) {
    parts.push(`Git branch: ${ctx.gitBranch || 'detached'}`)

    if (ctx.modifiedFiles.length > 0) {
      parts.push(`Modified files: ${ctx.modifiedFiles.slice(0, 10).join(', ')}`)
    }
    if (ctx.unstagedFiles.length > 0) {
      parts.push(`Untracked files: ${ctx.unstagedFiles.slice(0, 10).join(', ')}`)
    }

    if (ctx.recentCommits.length > 0) {
      parts.push(`Recent commits:`)
      ctx.recentCommits.forEach(c => parts.push(`  ${c}`))
    }
  } else {
    parts.push(`Git: not a git repository`)
  }
  parts.push(`</environment>`)

  if (ctx.directoryTree.length > 0) {
    parts.push(`\n<project_files>`)
    ctx.directoryTree.forEach(f => parts.push(f))
    if (ctx.directoryTree.length >= 30) {
      parts.push(`  ... (more files not shown)`)
    }
    parts.push(`</project_files>`)
  }

  return parts.join('\n')
}

/**
 * 获取上下文统计信息（用于 UI 显示）
 */
export function getContextSummary(ctx: ProjectContext): string {
  const parts: string[] = []

  if (ctx.isGitRepo) {
    parts.push(`branch: ${ctx.gitBranch}`)
    if (ctx.modifiedFiles.length > 0) {
      parts.push(`${ctx.modifiedFiles.length} modified`)
    }
  }

  parts.push(`${ctx.directoryTree.length} files`)
  return parts.join(' · ')
}
