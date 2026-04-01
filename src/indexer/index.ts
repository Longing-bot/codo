// ─── 代码索引与搜索增强 ──────────────────────────────────────────────────
// 基于正则的轻量代码索引（缓存函数/类/方法）
// 索引存储在 SQLite 中

import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { resolve, join, extname, relative } from 'path'
import Database from 'better-sqlite3'
import { homedir } from 'os'
import { mkdirSync } from 'fs'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface Symbol {
  name: string
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'const' | 'enum' | 'variable'
  file: string
  line: number
  signature: string
}

export interface IndexStats {
  files: number
  symbols: number
  lastUpdated: number
}

// ─── 语言模式 ──────────────────────────────────────────────────────────
interface LangPattern {
  name: Symbol['kind']
  regex: RegExp
}

const LANGUAGES: Record<string, LangPattern[]> = {
  '.ts': [
    { name: 'function', regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm },
    { name: 'function', regex: /^(?:async\s+)?function\s+(\w+)/gm },
    { name: 'class', regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm },
    { name: 'class', regex: /^(?:abstract\s+)?class\s+(\w+)/gm },
    { name: 'interface', regex: /^export\s+interface\s+(\w+)/gm },
    { name: 'interface', regex: /^interface\s+(\w+)/gm },
    { name: 'type', regex: /^export\s+type\s+(\w+)/gm },
    { name: 'type', regex: /^type\s+(\w+)/gm },
    { name: 'const', regex: /^export\s+const\s+(\w+)/gm },
    { name: 'enum', regex: /^export\s+(?:const\s+)?enum\s+(\w+)/gm },
  ],
  '.js': [
    { name: 'function', regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm },
    { name: 'function', regex: /^(?:async\s+)?function\s+(\w+)/gm },
    { name: 'class', regex: /^export\s+(?:default\s+)?class\s+(\w+)/gm },
    { name: 'class', regex: /^(?:default\s+)?class\s+(\w+)/gm },
    { name: 'const', regex: /^export\s+const\s+(\w+)/gm },
  ],
  '.py': [
    { name: 'function', regex: /^def\s+(\w+)/gm },
    { name: 'class', regex: /^class\s+(\w+)/gm },
    { name: 'variable', regex: /^(\w+)\s*=/gm },
  ],
  '.go': [
    { name: 'function', regex: /^func\s+(\w+)/gm },
    { name: 'function', regex: /^func\s+\([^)]+\)\s+(\w+)/gm }, // method
    { name: 'type', regex: /^type\s+(\w+)/gm },
    { name: 'const', regex: /^const\s+(\w+)/gm },
    { name: 'variable', regex: /^var\s+(\w+)/gm },
  ],
  '.rs': [
    { name: 'function', regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm },
    { name: 'class', regex: /^(?:pub\s+)?struct\s+(\w+)/gm },
    { name: 'enum', regex: /^(?:pub\s+)?enum\s+(\w+)/gm },
    { name: 'type', regex: /^(?:pub\s+)?type\s+(\w+)/gm },
    { name: 'const', regex: /^(?:pub\s+)?const\s+(\w+)/gm },
    { name: 'interface', regex: /^(?:pub\s+)?trait\s+(\w+)/gm },
  ],
  '.java': [
    { name: 'function', regex: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm },
    { name: 'class', regex: /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/gm },
    { name: 'interface', regex: /^public\s+interface\s+(\w+)/gm },
    { name: 'enum', regex: /^public\s+enum\s+(\w+)/gm },
  ],
  '.c': [
    { name: 'function', regex: /^(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm },
  ],
  '.cpp': [
    { name: 'function', regex: /^(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:\w+\s+)+?(\w+)\s*\(/gm },
    { name: 'class', regex: /^class\s+(\w+)/gm },
    { name: 'enum', regex: /^enum\s+(?:class\s+)?(\w+)/gm },
  ],
}

// 支持的扩展名
const SUPPORTED_EXTS = new Set(Object.keys(LANGUAGES))
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor', '.venv', 'venv', 'target'])

// ─── SQLite 索引存储 ─────────────────────────────────────────────────
let db: Database.Database | null = null

function getDb(): Database.Database | null {
  if (db) return db
  try {
    const dir = join(homedir(), '.edgecli')
    mkdirSync(dir, { recursive: true })
    db = new Database(join(dir, 'index.db'))
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        signature TEXT NOT NULL DEFAULT '',
        workspace TEXT NOT NULL DEFAULT '',
        indexed_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(name, kind, file, line, workspace)
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
      CREATE INDEX IF NOT EXISTS idx_symbols_workspace ON symbols(workspace);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    `)
    return db
  } catch {
    return null
  }
}

// ─── 文件扫描 ─────────────────────────────────────────────────────────
function scanFiles(dir: string, maxFiles: number = 500): string[] {
  const files: string[] = []

  function walk(currentDir: string) {
    if (files.length >= maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch { return }

    for (const entry of entries) {
      if (files.length >= maxFiles) return
      const fullPath = join(currentDir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          if (!IGNORE_DIRS.has(entry)) walk(fullPath)
        } else if (stat.isFile() && SUPPORTED_EXTS.has(extname(entry))) {
          files.push(fullPath)
        }
      } catch {}
    }
  }

  walk(dir)
  return files
}

// ─── 索引构建 ─────────────────────────────────────────────────────────
export function indexFile(filePath: string, workspace: string): Symbol[] {
  const ext = extname(filePath)
  const patterns = LANGUAGES[ext]
  if (!patterns) return []

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch { return [] }

  // 文件太大跳过
  if (content.length > 500_000) return []

  const lines = content.split('\n')
  const symbols: Symbol[] = []

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    // 重置 regex
    pattern.regex.lastIndex = 0
    while ((match = pattern.regex.exec(content)) !== null) {
      const name = match[1]
      if (!name) continue

      // 计算行号
      const lineNum = content.slice(0, match.index).split('\n').length
      const signature = lines[lineNum - 1]?.trim() || ''

      symbols.push({
        name,
        kind: pattern.name,
        file: filePath,
        line: lineNum,
        signature,
      })
    }
  }

  return symbols
}

export function indexWorkspace(workspace: string = process.cwd()): IndexStats {
  const database = getDb()
  const files = scanFiles(workspace)
  let totalSymbols = 0

  // 清除旧索引
  if (database) {
    database.prepare('DELETE FROM symbols WHERE workspace = ?').run(workspace)
  }

  const insertStmt = database?.prepare(
    'INSERT OR REPLACE INTO symbols (name, kind, file, line, signature, workspace, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const now = Date.now()

  for (const file of files) {
    const symbols = indexFile(file, workspace)
    totalSymbols += symbols.length

    if (database && insertStmt) {
      const relPath = relative(workspace, file)
      for (const sym of symbols) {
        try {
          insertStmt.run(sym.name, sym.kind, relPath, sym.line, sym.signature, workspace, now)
        } catch {}
      }
    }
  }

  return { files: files.length, symbols: totalSymbols, lastUpdated: now }
}

// ─── 搜索 ─────────────────────────────────────────────────────────────
export function searchSymbols(query: string, workspace: string = process.cwd(), limit: number = 50): Symbol[] {
  const database = getDb()
  if (!database) return []

  // 先尝试精确匹配
  const exact = database.prepare(
    'SELECT name, kind, file, line, signature FROM symbols WHERE workspace = ? AND name = ? LIMIT ?'
  ).all(workspace, query, limit) as Symbol[]

  if (exact.length > 0) return exact

  // 模糊匹配
  const fuzzy = database.prepare(
    'SELECT name, kind, file, line, signature FROM symbols WHERE workspace = ? AND name LIKE ? ORDER BY LENGTH(name) LIMIT ?'
  ).all(workspace, `%${query}%`, limit) as Symbol[]

  return fuzzy
}

export function searchSymbolsByKind(kind: Symbol['kind'], workspace: string = process.cwd(), limit: number = 50): Symbol[] {
  const database = getDb()
  if (!database) return []

  return database.prepare(
    'SELECT name, kind, file, line, signature FROM symbols WHERE workspace = ? AND kind = ? ORDER BY name LIMIT ?'
  ).all(workspace, kind, limit) as Symbol[]
}

export function getFileSymbols(filePath: string, workspace: string = process.cwd()): Symbol[] {
  const database = getDb()
  if (!database) return []

  const relPath = relative(workspace, resolve(filePath))
  return database.prepare(
    'SELECT name, kind, file, line, signature FROM symbols WHERE workspace = ? AND file = ? ORDER BY line'
  ).all(workspace, relPath) as Symbol[]
}

export function getIndexStats(workspace: string = process.cwd()): IndexStats {
  const database = getDb()
  if (!database) return { files: 0, symbols: 0, lastUpdated: 0 }

  const result = database.prepare(
    'SELECT COUNT(DISTINCT file) as files, COUNT(*) as symbols, MAX(indexed_at) as lastUpdated FROM symbols WHERE workspace = ?'
  ).get(workspace) as any

  return {
    files: result?.files || 0,
    symbols: result?.symbols || 0,
    lastUpdated: result?.lastUpdated || 0,
  }
}

// ─── 增量更新 ─────────────────────────────────────────────────────────
export function updateFileIndex(filePath: string, workspace: string = process.cwd()): Symbol[] {
  const database = getDb()
  const relPath = relative(workspace, resolve(filePath))

  // 删除旧索引
  if (database) {
    database.prepare('DELETE FROM symbols WHERE workspace = ? AND file = ?').run(workspace, relPath)
  }

  // 重新索引
  return indexFile(resolve(filePath), workspace)
}

// ─── 格式化 ──────────────────────────────────────────────────────────
export function formatSymbols(symbols: Symbol[]): string {
  if (symbols.length === 0) return '没有找到匹配的符号。'

  const lines: string[] = []
  let currentFile = ''

  for (const sym of symbols) {
    if (sym.file !== currentFile) {
      currentFile = sym.file
      lines.push(`\n📄 ${sym.file}`)
    }
    const kindIcon = {
      function: 'ƒ', class: 'C', method: 'm', interface: 'I',
      type: 'T', const: 'K', enum: 'E', variable: 'v',
    }[sym.kind] || '?'
    lines.push(`  ${kindIcon} ${sym.name}:${sym.line}  ${sym.signature.slice(0, 60)}`)
  }

  return lines.join('\n')
}
