// ─── 动态上下文选择器 ──────────────────────────────────────────────────
// 根据用户问题智能选择相关文件，管理 token 预算
// 解决：把所有文件塞进 system prompt 的浪费问题

import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { resolve, join, extname, basename } from 'path'
import { execSync } from 'child_process'
import type { Message } from '../config/index.js'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface FileCandidate {
  path: string
  relevance: number       // 0-1 相关性分数
  reason: string          // 为什么选择这个文件
  tokenEstimate: number   // 预估 token 数
  priority: 'high' | 'medium' | 'low'
}

export interface TokenBudget {
  system: number
  files: number
  history: number
  total: number
}

export interface ContextConfig {
  totalBudget: number       // 总 token 预算
  systemRatio: number       // system prompt 占比
  filesRatio: number        // 文件内容占比
  historyRatio: number      // 对话历史占比
  maxFiles: number          // 最多加载文件数
  cacheTTL: number          // 缓存 TTL（ms）
}

export interface SelectedFile {
  path: string
  content: string
  truncated: boolean
  tokenEstimate: number
}

// ─── 默认配置 ──────────────────────────────────────────────────────────
const DEFAULT_CONFIG: ContextConfig = {
  totalBudget: 30000,
  systemRatio: 0.17,    // ~5K
  filesRatio: 0.66,     // ~20K
  historyRatio: 0.17,   // ~5K
  maxFiles: 15,
  cacheTTL: 30000,      // 30 秒
}

// ─── 文件内容缓存 ──────────────────────────────────────────────────────
interface CacheEntry {
  content: string
  timestamp: number
}
const fileCache: Map<string, CacheEntry> = new Map()

function getCachedFile(filePath: string, ttl: number): string | null {
  const entry = fileCache.get(filePath)
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.content
  }
  return null
}

function setCachedFile(filePath: string, content: string): void {
  fileCache.set(filePath, { content, timestamp: Date.now() })
}

export function clearFileCache(): void {
  fileCache.clear()
}

// ─── Token 估算 ────────────────────────────────────────────────────────
// 粗略估算：1 token ≈ 4 字符（英文）或 2 字符（中文）
export function estimateTokens(text: string): number {
  // 简单估算：按字符数 / 2.5
  return Math.ceil(text.length / 2.5)
}

// ─── 关键词提取 ────────────────────────────────────────────────────────
function extractKeywords(query: string): string[] {
  // 移除常见停用词
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
    'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'don', 'didn', 'won',
    'isn', 'aren', 'wasn', 'weren', 'doesn', 'hasn', 'haven', 'hadn', 'couldn',
    'wouldn', 'shouldn', 'the', 'this', 'that', 'these', 'those', 'what', 'which',
    'who', 'whom', 'it', 'its', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
    'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'they',
    'them', 'their', 'theirs', '和', '的', '了', '在', '是', '我', '有', '和',
    '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要',
    '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '它',
    '们', '什么', '吗', '吧', '呢', '啊', '哦', '把', '被', '让', '给', '从',
    '请', '帮', '帮我', '看看', '怎么', '如何', '为什么', '哪个', '哪些'])

  // 提取有意义的词
  const words = query
    .replace(/[^\w\u4e00-\u9fff\s\-_./]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
    .map(w => w.toLowerCase())

  // 去重
  return [...new Set(words)]
}

// ─── Git 变更文件 ──────────────────────────────────────────────────────
function getGitModifiedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    return output ? output.split('\n') : []
  } catch {
    return []
  }
}

function getGitRecentFiles(days = 7): string[] {
  try {
    const output = execSync(`git log --since="${days} days ago" --name-only --pretty=format: 2>/dev/null | sort -u | head -20`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    return output ? output.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

// ─── Import 分析 ───────────────────────────────────────────────────────
function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = []
  const dir = resolve(filePath, '..')

  // TypeScript/JavaScript imports
  const tsImportRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match
  while ((match = tsImportRegex.exec(content)) !== null) {
    const imp = match[1]
    // 相对路径导入
    if (imp.startsWith('.')) {
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']
      for (const ext of extensions) {
        const fullPath = resolve(dir, imp + ext)
        if (existsSync(fullPath)) {
          imports.push(fullPath)
          break
        }
      }
    }
  }

  // Python imports
  const pyImportRegex = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm
  while ((match = pyImportRegex.exec(content)) !== null) {
    const mod = match[1] || match[2]
    const parts = mod.split('.')
    const filePath2 = join(dir, ...parts) + '.py'
    if (existsSync(filePath2)) {
      imports.push(filePath2)
    }
    const initPath = join(dir, ...parts, '__init__.py')
    if (existsSync(initPath)) {
      imports.push(initPath)
    }
  }

  return imports
}

// ─── 文件评分 ──────────────────────────────────────────────────────────
function scoreFile(filePath: string, keywords: string[], gitModified: string[], gitRecent: string[], cwd: string): number {
  let score = 0
  const fileName = basename(filePath).toLowerCase()
  const relPath = filePath.replace(cwd + '/', '').toLowerCase()

  // 1. 文件名匹配关键词
  for (const kw of keywords) {
    if (fileName.includes(kw)) score += 0.4
    if (relPath.includes(kw)) score += 0.2
  }

  // 2. Git 修改文件加分
  const relPathFromCwd = filePath.replace(cwd + '/', '')
  if (gitModified.includes(relPathFromCwd)) score += 0.3
  if (gitRecent.includes(relPathFromCwd)) score += 0.15

  // 3. 文件类型权重
  const ext = extname(filePath)
  const importantExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'])
  if (importantExts.has(ext)) score += 0.1

  // 4. 常见重要文件加分
  const importantFiles = ['index.ts', 'index.tsx', 'index.js', 'main.ts', 'main.py',
    'app.ts', 'app.tsx', 'config.ts', 'types.ts', 'schema.ts']
  if (importantFiles.includes(fileName)) score += 0.15

  return Math.min(1, score)
}

// ─── 主选择函数 ────────────────────────────────────────────────────────
export function selectRelevantFiles(
  userQuery: string,
  cwd: string = process.cwd(),
  config: Partial<ContextConfig> = {}
): FileCandidate[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const keywords = extractKeywords(userQuery)

  // 如果没有关键词，返回空
  if (keywords.length === 0) return []

  const gitModified = getGitModifiedFiles()
  const gitRecent = getGitRecentFiles()

  // 收集所有候选文件
  const candidates: FileCandidate[] = []
  const visited = new Set<string>()

  function scanDir(dir: string, depth: number): void {
    if (depth > 3) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          // 跳过无关目录
          if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor'].includes(entry.name)) continue
          scanDir(fullPath, depth + 1)
        } else if (entry.isFile()) {
          if (visited.has(fullPath)) continue
          visited.add(fullPath)

          const ext = extname(entry.name)
          const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
            '.rb', '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.json', '.yaml', '.yml',
            '.toml', '.md', '.sql', '.graphql', '.proto'])

          if (!codeExts.has(ext)) continue

          const score = scoreFile(fullPath, keywords, gitModified, gitRecent, cwd)
          if (score > 0.1) {
            try {
              const size = statSync(fullPath).size
              if (size > 500_000) continue // 跳过 >500KB 的文件

              candidates.push({
                path: fullPath,
                relevance: score,
                reason: buildReason(fullPath, keywords, gitModified, gitRecent, cwd),
                tokenEstimate: Math.ceil(size / 2.5),
                priority: score > 0.6 ? 'high' : score > 0.3 ? 'medium' : 'low',
              })
            } catch {}
          }
        }
      }
    } catch {}
  }

  scanDir(cwd, 0)

  // 按相关性排序
  candidates.sort((a, b) => b.relevance - a.relevance)

  // 限制数量
  return candidates.slice(0, cfg.maxFiles * 2) // 多取一些，后面按预算截断
}

function buildReason(filePath: string, keywords: string[], gitModified: string[], gitRecent: string[], cwd: string): string {
  const reasons: string[] = []
  const fileName = basename(filePath).toLowerCase()
  const relPath = filePath.replace(cwd + '/', '')

  for (const kw of keywords) {
    if (fileName.includes(kw)) reasons.push(`文件名匹配 "${kw}"`)
  }
  if (gitModified.includes(relPath)) reasons.push('最近 git 修改')
  if (gitRecent.includes(relPath)) reasons.push('近期活跃')

  return reasons.length > 0 ? reasons[0] : '关键词相关'
}

// ─── Token 预算计算 ────────────────────────────────────────────────────
export function calculateTokenBudget(config: Partial<ContextConfig> = {}): TokenBudget {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  return {
    system: Math.round(cfg.totalBudget * cfg.systemRatio),
    files: Math.round(cfg.totalBudget * cfg.filesRatio),
    history: Math.round(cfg.totalBudget * cfg.historyRatio),
    total: cfg.totalBudget,
  }
}

// ─── 构建上下文 ────────────────────────────────────────────────────────
export function buildContext(
  candidates: FileCandidate[],
  budget: TokenBudget,
  cwd: string = process.cwd(),
  config: Partial<ContextConfig> = {}
): SelectedFile[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const selected: SelectedFile[] = []
  let usedTokens = 0

  for (const candidate of candidates) {
    if (usedTokens >= budget.files) break
    if (selected.length >= cfg.maxFiles) break

    // 读取文件（带缓存）
    let content = getCachedFile(candidate.path, cfg.cacheTTL)
    if (content === null) {
      try {
        content = readFileSync(candidate.path, 'utf-8')
        setCachedFile(candidate.path, content)
      } catch {
        continue
      }
    }

    const fileTokens = estimateTokens(content)
    let truncated = false

    // 如果超出预算，截断
    if (usedTokens + fileTokens > budget.files) {
      const remainingBudget = budget.files - usedTokens
      if (remainingBudget < 200) break // 剩余太少，跳过

      // 按比例截断
      const ratio = remainingBudget / fileTokens
      const charLimit = Math.floor(content.length * ratio)
      content = content.slice(0, charLimit) + '\n... (截断)'
      truncated = true
    }

    const relPath = candidate.path.replace(cwd + '/', '')
    selected.push({
      path: relPath,
      content,
      truncated,
      tokenEstimate: truncated ? estimateTokens(content) : fileTokens,
    })

    usedTokens += truncated ? estimateTokens(content) : fileTokens
  }

  return selected
}

// ─── 格式化为 Prompt ───────────────────────────────────────────────────
export function formatSelectedFilesForPrompt(files: SelectedFile[]): string {
  if (files.length === 0) return ''

  const lines = ['<relevant_files>']
  for (const file of files) {
    lines.push(`--- ${file.path} ${file.truncated ? '(截断)' : ''} ---`)
    lines.push(file.content)
    lines.push('')
  }
  lines.push('</relevant_files>')

  return lines.join('\n')
}

// ─── 统计信息 ──────────────────────────────────────────────────────────
export function getContextSelectorStats(candidates: FileCandidate[], selected: SelectedFile[]): string {
  const totalTokens = selected.reduce((s, f) => s + f.tokenEstimate, 0)
  const truncated = selected.filter(f => f.truncated).length
  return `${selected.length}/${candidates.length} 文件, ~${totalTokens} tokens${truncated > 0 ? `, ${truncated} 截断` : ''}`
}

// ─── 基于 import 链扩展候选文件 ─────────────────────────────────────────
export function expandByImports(candidates: FileCandidate[], cwd: string = process.cwd()): FileCandidate[] {
  const existingPaths = new Set(candidates.map(c => c.path))
  const expanded = [...candidates]

  for (const candidate of candidates.slice(0, 5)) { // 只分析 top 5 文件的 imports
    try {
      const content = readFileSync(candidate.path, 'utf-8')
      const imports = extractImports(content, candidate.path)
      for (const imp of imports) {
        if (!existingPaths.has(imp)) {
          existingPaths.add(imp)
          expanded.push({
            path: imp,
            relevance: candidate.relevance * 0.5, // import 依赖的分数降半
            reason: `${basename(candidate.path)} 的依赖`,
            tokenEstimate: 0,
            priority: 'low',
          })
        }
      }
    } catch {}
  }

  return expanded
}
