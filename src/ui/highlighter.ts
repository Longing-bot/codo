// ─── 终端代码语法高亮 ─────────────────────────────────────────────────
// 轻量级语法高亮，返回 color 标记数组供 Ink 渲染
// 支持: TypeScript, JavaScript, Python, Go, Rust, JSON, Bash, HTML, CSS

export interface HighlightToken {
  text: string
  color: string
  bold?: boolean
  dim?: boolean
}

// ─── 语言特定的高亮规则 ─────────────────────────────────────────────────
const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new',
  'this', 'super', 'import', 'export', 'default', 'from', 'as', 'async',
  'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'null', 'undefined', 'true', 'false', 'void', 'delete', 'in', 'of',
  'interface', 'type', 'enum', 'implements', 'abstract', 'readonly',
  'public', 'private', 'protected', 'static', 'override', 'declare',
  'module', 'namespace', 'require', 'yield', 'with',
])

const PYTHON_KEYWORDS = new Set([
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break',
  'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise',
  'with', 'yield', 'lambda', 'pass', 'del', 'global', 'nonlocal', 'assert',
  'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'async', 'await',
])

const GO_KEYWORDS = new Set([
  'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default',
  'break', 'continue', 'go', 'defer', 'select', 'chan', 'package', 'import',
  'var', 'const', 'type', 'struct', 'interface', 'map', 'make', 'new', 'nil',
  'true', 'false', 'append', 'delete', 'len', 'cap', 'copy', 'close', 'panic',
  'recover', 'error', 'string', 'int', 'bool', 'byte', 'float64', 'float32',
])

const RUST_KEYWORDS = new Set([
  'fn', 'let', 'mut', 'const', 'if', 'else', 'for', 'while', 'loop', 'match',
  'return', 'break', 'continue', 'struct', 'enum', 'impl', 'trait', 'pub',
  'use', 'mod', 'crate', 'self', 'super', 'where', 'async', 'await', 'move',
  'ref', 'type', 'unsafe', 'static', 'true', 'false', 'Some', 'None', 'Ok',
  'Err', 'Self', 'Box', 'Vec', 'String', 'Option', 'Result', 'Rc', 'Arc',
])

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
  'esac', 'function', 'return', 'local', 'export', 'source', 'alias', 'echo',
  'exit', 'set', 'shift', 'true', 'false', 'in', 'select', 'trap', 'readonly',
])

// ─── Tokenizer ─────────────────────────────────────────────────────────
function tokenizeLine(line: string, lang: string): HighlightToken[] {
  const tokens: HighlightToken[] = []
  const keywords = getKeywords(lang)

  let i = 0
  while (i < line.length) {
    // 字符串
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++
        j++
      }
      if (j < line.length) j++ // closing quote
      tokens.push({ text: line.slice(i, j), color: 'green' })
      i = j
      continue
    }

    // 数字
    if (/\d/.test(line[i]) && (i === 0 || /[\s+\-*/=<>!&|^~%([,;:{]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[\d.xXa-fA-F_eE]/.test(line[j])) j++
      tokens.push({ text: line.slice(i, j), color: 'cyan' })
      i = j
      continue
    }

    // 注释
    if (line.slice(i, i + 2) === '//' || line.slice(i, i + 1) === '#') {
      tokens.push({ text: line.slice(i), color: 'gray', dim: true })
      i = line.length
      continue
    }

    // 单词（关键字/标识符）
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++
      const word = line.slice(i, j)
      if (keywords.has(word)) {
        tokens.push({ text: word, color: 'magenta', bold: true })
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ text: word, color: 'yellow' })
      } else if (j < line.length && line[j] === '(') {
        tokens.push({ text: word, color: 'blue' }) // function call
      } else {
        tokens.push({ text: word, color: 'white' })
      }
      i = j
      continue
    }

    // 操作符
    if (/[+\-*/=<>!&|^~%]/.test(line[i])) {
      tokens.push({ text: line[i], color: 'red' })
      i++
      continue
    }

    // 括号
    if (/[(){}\[\]]/.test(line[i])) {
      tokens.push({ text: line[i], color: 'yellow' })
      i++
      continue
    }

    // 其他
    tokens.push({ text: line[i], color: 'white' })
    i++
  }

  return tokens
}

function getKeywords(lang: string): Set<string> {
  switch (lang.toLowerCase()) {
    case 'typescript':
    case 'ts':
    case 'tsx':
    case 'javascript':
    case 'js':
    case 'jsx':
      return JS_KEYWORDS
    case 'python':
    case 'py':
      return PYTHON_KEYWORDS
    case 'go':
      return GO_KEYWORDS
    case 'rust':
    case 'rs':
      return RUST_KEYWORDS
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      return BASH_KEYWORDS
    default:
      return JS_KEYWORDS
  }
}

// ─── 主高亮函数 ────────────────────────────────────────────────────────
export function highlightCode(code: string, lang: string = ''): HighlightToken[][] {
  const lines = code.split('\n')
  return lines.map(line => tokenizeLine(line, lang))
}

// ─── 检测代码块语言 ────────────────────────────────────────────────────
export function detectLanguage(code: string): string {
  if (code.includes('interface ') && code.includes(': ')) return 'typescript'
  if (code.includes('def ') && code.includes(':')) return 'python'
  if (code.includes('func ') && code.includes('{')) return 'go'
  if (code.includes('fn ') && code.includes('->')) return 'rust'
  if (code.includes('{') && code.includes('"') && !code.includes('function')) return 'json'
  if (code.includes('#!/') && (code.includes('bash') || code.includes('sh'))) return 'bash'
  if (code.includes('import ') && code.includes('from ')) return 'typescript'
  if (code.includes('const ') || code.includes('let ') || code.includes('function ')) return 'typescript'
  return ''
}

// ─── 从 markdown 代码块提取语言 ─────────────────────────────────────────
export function extractCodeBlocks(text: string): Array<{ lang: string; code: string; startLine: number }> {
  const blocks: Array<{ lang: string; code: string; startLine: number }> = []
  const lines = text.split('\n')
  let inBlock = false
  let blockLang = ''
  let blockCode: string[] = []
  let blockStart = 0

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) {
      if (!inBlock) {
        inBlock = true
        blockLang = lines[i].slice(3).trim()
        blockCode = []
        blockStart = i
      } else {
        blocks.push({ lang: blockLang || detectLanguage(blockCode.join('\n')), code: blockCode.join('\n'), startLine: blockStart })
        inBlock = false
      }
    } else if (inBlock) {
      blockCode.push(lines[i])
    }
  }

  return blocks
}
