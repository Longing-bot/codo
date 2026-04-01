// ─── Edit 格式系统（参考 Aider）────────────────────────────────────────
// 支持 whole / search-replace / diff-edit 三种编辑模式

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, basename } from 'path'
import { applyPatch, parsePatch, structuredPatch } from 'diff'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export type EditFormat = 'whole' | 'search-replace' | 'diff-edit'

export interface SearchReplaceBlock {
  filePath: string
  search: string
  replace: string
  lineNum?: number
}

export interface EditResult {
  success: boolean
  filePath: string
  format: EditFormat
  message: string
  oldLines?: number
  newLines?: number
}

export interface ParsedEdit {
  format: EditFormat
  blocks: SearchReplaceBlock[]
  wholeFiles: Map<string, string> // filePath → content
  diffs: Map<string, string>     // filePath → unified diff
}

// ─── Search-Replace 块解析 ────────────────────────────────────────────
const SR_MARKER_START = '<<<<<<< SEARCH'
const SR_MARKER_MID = '======='
const SR_MARKER_END = '>>>>>>> REPLACE'

/**
 * 解析 LLM 返回的 search-replace 块
 * 格式：
 *   path/to/file
 *   <<<<<<< SEARCH
 *   old code
 *   =======
 *   new code
 *   >>>>>>> REPLACE
 */
export function parseSearchReplaceBlocks(text: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = []
  const lines = text.split('\n')

  let currentFile: string | null = null
  let inSearch = false
  let inReplace = false
  let searchLines: string[] = []
  let replaceLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 检测文件路径（在 marker 前的行）
    if (!inSearch && !inReplace) {
      if (line === SR_MARKER_START) {
        inSearch = true
        searchLines = []
        continue
      }
      // 尝试检测文件路径行
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('<<<<<<<') && !trimmed.startsWith('===') && !trimmed.startsWith('>>>>>>>')) {
        // 检查是否像文件路径（包含 / 或 . 后缀）
        if (trimmed.includes('/') || trimmed.includes('.')) {
          // 检查下一行是否是 SEARCH marker
          if (i + 1 < lines.length && lines[i + 1].trim() === SR_MARKER_START) {
            currentFile = trimmed
          }
        }
      }
      continue
    }

    if (inSearch && line === SR_MARKER_MID) {
      inSearch = false
      inReplace = true
      replaceLines = []
      continue
    }

    if (inReplace && line === SR_MARKER_END) {
      inReplace = false
      if (currentFile) {
        blocks.push({
          filePath: currentFile,
          search: searchLines.join('\n'),
          replace: replaceLines.join('\n'),
        })
      }
      currentFile = null
      searchLines = []
      replaceLines = []
      continue
    }

    if (inSearch) searchLines.push(line)
    else if (inReplace) replaceLines.push(line)
  }

  return blocks
}

// ─── Unified Diff 解析 ───────────────────────────────────────────────
/**
 * 从 LLM 返回中提取 unified diff 格式的编辑
 * 支持多个文件的 diff
 */
export function parseDiffEdits(text: string): Map<string, string> {
  const diffs = new Map<string, string>()

  // 找 diff 块：以 --- 和 +++ 开头
  const diffRegex = /(?:^|\n)((?:---\s+\S+\n\+\+\+\s+\S+\n(?:@@.*@@\n(?:[-+\s].*\n)*)*))/gm
  let match: RegExpExecArray | null

  while ((match = diffRegex.exec(text)) !== null) {
    const diffBlock = match[1]
    // 提取文件路径
    const pathMatch = diffBlock.match(/\+\+\+\s+(?:b\/)?(.+)/)
    if (pathMatch) {
      const filePath = pathMatch[1].trim()
      if (filePath !== '/dev/null') {
        diffs.set(filePath, diffBlock)
      }
    }
  }

  return diffs
}

// ─── Whole File 解析 ─────────────────────────────────────────────────
/**
 * 从 LLM 返回中提取整个文件重写
 * 识别 ```path/to/file ... ``` 格式
 */
export function parseWholeFiles(text: string): Map<string, string> {
  const files = new Map<string, string>()

  // 匹配 ```filepath\ncontent\n``` 格式
  const blockRegex = /```([^\n`]+\.\w+)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(text)) !== null) {
    const filePath = match[1].trim()
    const content = match[2]
    // 只匹配看起来像文件路径的
    if (filePath.includes('/') || filePath.includes('.')) {
      files.set(filePath, content.replace(/\n$/, ''))
    }
  }

  return files
}

// ─── 统一解析入口 ────────────────────────────────────────────────────
export function parseEdits(text: string, format: EditFormat): ParsedEdit {
  const result: ParsedEdit = {
    format,
    blocks: [],
    wholeFiles: new Map(),
    diffs: new Map(),
  }

  switch (format) {
    case 'search-replace':
      result.blocks = parseSearchReplaceBlocks(text)
      break
    case 'diff-edit':
      result.diffs = parseDiffEdits(text)
      break
    case 'whole':
      result.wholeFiles = parseWholeFiles(text)
      break
  }

  return result
}

// ─── 执行编辑 ─────────────────────────────────────────────────────────
export function applySearchReplace(block: SearchReplaceBlock): EditResult {
  const p = resolve(block.filePath)

  if (!existsSync(p)) {
    // 文件不存在，创建新文件
    try {
      const { mkdirSync } = require('fs')
      const { dirname } = require('path')
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, block.replace)
      return {
        success: true,
        filePath: block.filePath,
        format: 'search-replace',
        message: `✅ Created ${block.filePath}`,
        oldLines: 0,
        newLines: block.replace.split('\n').length,
      }
    } catch (ex: any) {
      return {
        success: false,
        filePath: block.filePath,
        format: 'search-replace',
        message: `创建文件失败: ${ex.message}`,
      }
    }
  }

  const content = readFileSync(p, 'utf-8')
  const occurrences = content.split(block.search).length - 1

  if (occurrences === 0) {
    return {
      success: false,
      filePath: block.filePath,
      format: 'search-replace',
      message: `SEARCH 块未找到于 ${block.filePath}。文件可能已变更。`,
    }
  }
  if (occurrences > 1) {
    return {
      success: false,
      filePath: block.filePath,
      format: 'search-replace',
      message: `SEARCH 块在 ${block.filePath} 中匹配了 ${occurrences} 次。需要更多上下文。`,
    }
  }

  const newContent = content.replace(block.search, block.replace)
  const oldLines = block.search.split('\n').length
  const newLines = block.replace.split('\n').length

  writeFileSync(p, newContent)
  return {
    success: true,
    filePath: block.filePath,
    format: 'search-replace',
    message: `✏️ ${basename(p)} (${oldLines}→${newLines} lines)`,
    oldLines,
    newLines,
  }
}

export function applyDiffEdit(filePath: string, diffText: string): EditResult {
  const p = resolve(filePath)

  if (!existsSync(p)) {
    return {
      success: false,
      filePath,
      format: 'diff-edit',
      message: `文件不存在: ${filePath}`,
    }
  }

  try {
    const content = readFileSync(p, 'utf-8')
    const patches = parsePatch(diffText)

    if (patches.length === 0) {
      return {
        success: false,
        filePath,
        format: 'diff-edit',
        message: `无法解析 diff 格式: ${filePath}`,
      }
    }

    const result = applyPatch(content, patches[0])
    if (result === false) {
      return {
        success: false,
        filePath,
        format: 'diff-edit',
        message: `应用 diff 失败: ${filePath}`,
      }
    }

    writeFileSync(p, result)

    // 统计行数变化
    const patch = patches[0]
    let added = 0, removed = 0
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }

    return {
      success: true,
      filePath,
      format: 'diff-edit',
      message: `✏️ ${basename(p)} (+${added} -${removed} lines)`,
      oldLines: removed,
      newLines: added,
    }
  } catch (ex: any) {
    return {
      success: false,
      filePath,
      format: 'diff-edit',
      message: `应用 diff 失败: ${ex.message}`,
    }
  }
}

export function applyWholeFile(filePath: string, content: string): EditResult {
  const p = resolve(filePath)
  const existed = existsSync(p)
  const oldLines = existed ? readFileSync(p, 'utf-8').split('\n').length : 0

  try {
    const { mkdirSync } = require('fs')
    const { dirname } = require('path')
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
    const newLines = content.split('\n').length
    return {
      success: true,
      filePath,
      format: 'whole',
      message: existed
        ? `✏️ ${basename(p)} (${oldLines}→${newLines} lines)`
        : `✅ Created ${basename(p)} (${newLines} lines)`,
      oldLines,
      newLines,
    }
  } catch (ex: any) {
    return {
      success: false,
      filePath,
      format: 'whole',
      message: `写入文件失败: ${ex.message}`,
    }
  }
}

// ─── 批量执行 ─────────────────────────────────────────────────────────
export function applyAllEdits(parsed: ParsedEdit): EditResult[] {
  const results: EditResult[] = []

  switch (parsed.format) {
    case 'search-replace':
      for (const block of parsed.blocks) {
        results.push(applySearchReplace(block))
      }
      break
    case 'diff-edit':
      for (const [filePath, diff] of parsed.diffs) {
        results.push(applyDiffEdit(filePath, diff))
      }
      break
    case 'whole':
      for (const [filePath, content] of parsed.wholeFiles) {
        results.push(applyWholeFile(filePath, content))
      }
      break
  }

  return results
}

// ─── System Prompt 片段 ──────────────────────────────────────────────
export function getSearchReplacePrompt(): string {
  return `## Edit Format: search-replace

When editing files, use SEARCH/REPLACE blocks:

\`\`\`
path/to/file.py
<<<<<<< SEARCH
# old code to find (must be exact match)
=======
# new code to replace with
>>>>>>> REPLACE
\`\`\`

Rules:
- SEARCH block must match exactly (including whitespace)
- Each SEARCH block must match exactly once in the file
- Include enough context in SEARCH for unique match
- Multiple blocks can edit different parts of the same file
- To create a new file, use empty SEARCH block
- You can use multiple SEARCH/REPLACE blocks in one response
`
}

export function getDiffEditPrompt(): string {
  return `## Edit Format: diff-edit

When editing files, use unified diff format:

\`\`\`
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -10,7 +10,7 @@
 context line
-old line
+new line
 context line
\`\`\`

Rules:
- Use standard unified diff format
- Context lines (starting with space) help locate the change
- Multiple hunks per file are supported
- Multiple files can be edited in one response
`
}

// ─── 编辑格式配置 ────────────────────────────────────────────────────
export function getEditFormatPrompt(format: EditFormat): string {
  switch (format) {
    case 'search-replace':
      return getSearchReplacePrompt()
    case 'diff-edit':
      return getDiffEditPrompt()
    case 'whole':
      return ''
  }
}
