import React from 'react'
import { Box, Text } from 'ink'
import { highlightCode, extractCodeBlocks, type HighlightToken } from '../highlighter.js'

export type EntryType = 'user' | 'assistant' | 'tool' | 'toolResult' | 'error' | 'system' | 'command' | 'approval'

export interface Entry {
  type: EntryType
  content: string
  toolName?: string
  toolArgs?: string
  timestamp?: number
  duration?: number    // 工具执行耗时 (ms)
  success?: boolean    // 工具执行是否成功
}

export interface MessageListProps {
  entries: Entry[]
}

// ─── 代码块渲染（带语法高亮）────────────────────────────────────────────
function HighlightedLine({ tokens }: { tokens: HighlightToken[] }) {
  return (
    <>
      {tokens.map((token, i) => (
        <Text key={i} color={token.color as any} bold={token.bold} dimColor={token.dim}>
          {token.text}
        </Text>
      ))}
    </>
  )
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const highlightedLines = highlightCode(code, lang)
  const codeLines = code.split('\n')
  const showLineNumbers = codeLines.length > 2

  return (
    <Box flexDirection="column" marginLeft={showLineNumbers ? 0 : 3}>
      {lang && (
        <Box marginLeft={3}>
          <Text dimColor>┌─ {lang} </Text>
          <Text dimColor>{'─'.repeat(Math.max(0, 40 - lang.length))}</Text>
        </Box>
      )}
      {highlightedLines.map((tokens, i) => (
        <Box key={i}>
          {showLineNumbers && (
            <Text dimColor>{String(i + 1).padStart(4)} │ </Text>
          )}
          <HighlightedLine tokens={tokens} />
        </Box>
      ))}
      {lang && (
        <Box marginLeft={3}>
          <Text dimColor>└{'─'.repeat(42)}</Text>
        </Box>
      )}
    </Box>
  )
}

// ─── 带代码高亮的消息渲染 ──────────────────────────────────────────────
function MessageWithHighlight({ content, marginLeft = 2 }: { content: string; marginLeft?: number }) {
  const blocks = extractCodeBlocks(content)

  if (blocks.length === 0) {
    // 没有代码块，直接渲染
    return (
      <Box marginLeft={marginLeft}>
        <Text>{content}</Text>
      </Box>
    )
  }

  // 有代码块，分割渲染
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      const lang = lines[i].slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      parts.push({ type: 'code', content: codeLines.join('\n'), lang: lang || undefined })
    } else {
      const textLines: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        textLines.push(lines[i])
        i++
      }
      if (textLines.length > 0) {
        parts.push({ type: 'text', content: textLines.join('\n') })
      }
    }
  }

  return (
    <Box flexDirection="column" marginLeft={marginLeft}>
      {parts.map((part, i) => (
        part.type === 'code' ? (
          <CodeBlock key={i} code={part.content} lang={part.lang || ''} />
        ) : (
          <Box key={i}>
            <Text>{part.content}</Text>
          </Box>
        )
      ))}
    </Box>
  )
}

// ─── 工具调用可视化 ────────────────────────────────────────────────────
function toolEmoji(toolName: string): string {
  const map: Record<string, string> = {
    read_file: '📖',
    write_file: '✏️',
    edit_file: '📝',
    patch_file: '🔧',
    bash: '⚡',
    glob: '🔍',
    grep: '🔎',
    web_search: '🌐',
    fetch: '📡',
    think: '💭',
    test_runner: '🧪',
    todo: '📋',
  }
  return map[toolName] || '⚙️'
}

function ToolCallEntry({ entry }: { entry: Entry }) {
  const name = entry.toolName || ''
  const emoji = toolEmoji(name)
  const args = entry.toolArgs || ''

  // 参数摘要：截断长参数
  const argSummary = args.length > 60 ? args.slice(0, 60) + '…' : args

  return (
    <Box marginLeft={2}>
      <Text color="blue">{'>'} </Text>
      <Text color="yellow">{emoji} {name}</Text>
      <Text dimColor> {argSummary}</Text>
    </Box>
  )
}

function ToolResultEntry({ entry }: { entry: Entry }) {
  const name = entry.toolName || ''
  const success = entry.success !== false
  const duration = entry.duration
  const content = entry.content

  // 结果摘要
  const lines = content.split('\n')
  const summary = lines.length > 1
    ? lines[0].slice(0, 70) + (lines[0].length > 70 ? '…' : '')
    : content.slice(0, 70)

  // 耗时显示
  const durationStr = duration && duration > 500
    ? ` (${(duration / 1000).toFixed(1)}s)`
    : ''

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Box>
        <Text dimColor>│ </Text>
        <Text color={success ? 'green' : 'red'}>
          {success ? '✓' : '✗'}
        </Text>
        <Text dimColor> {summary}</Text>
        {durationStr && <Text dimColor>{durationStr}</Text>}
        {lines.length > 1 && <Text dimColor> ({lines.length} 行)</Text>}
      </Box>
    </Box>
  )
}

// ─── 主组件 ────────────────────────────────────────────────────────────
export function MessageList({ entries }: MessageListProps) {
  return (
    <>
      {entries.map((e, i) => (
        <Box key={i} marginBottom={0}>
          {e.type === 'user' && (
            <Box>
              <Text color="blue">{'>'} </Text>
              <Text bold>{e.content}</Text>
            </Box>
          )}
          {e.type === 'assistant' && (
            <MessageWithHighlight content={e.content} marginLeft={2} />
          )}
          {e.type === 'tool' && (
            <ToolCallEntry entry={e} />
          )}
          {e.type === 'toolResult' && (
            <ToolResultEntry entry={e} />
          )}
          {e.type === 'system' && (
            <Box marginLeft={3}>
              <Text dimColor>│ {e.content}</Text>
            </Box>
          )}
          {e.type === 'command' && (
            <Box marginLeft={2}>
              <Text color="magenta">{e.content}</Text>
            </Box>
          )}
          {e.type === 'error' && (
            <Box marginLeft={2}>
              <Text color="red">{'>'} </Text>
              <Text color="red">{e.content}</Text>
            </Box>
          )}
        </Box>
      ))}
    </>
  )
}
