// ─── Diff 显示组件（增强版）───────────────────────────────────────────────
import React from 'react'
import { Box, Text } from 'ink'
import { computeDiff, type DiffLine } from '../diff.js'

interface DiffViewProps {
  oldText: string
  newText: string
  filePath?: string
  maxLines?: number
  showLineNumbers?: boolean
  animate?: boolean    // 是否启用逐行动画（目前用分批显示模拟）
}

export function DiffView({ oldText, newText, filePath, maxLines = 20, showLineNumbers = true }: DiffViewProps) {
  const lines = computeDiff(oldText, newText, filePath)
  const displayed = lines.slice(0, maxLines)

  // 统计
  const added = lines.filter(l => l.type === 'add').length
  const removed = lines.filter(l => l.type === 'remove').length

  return (
    <Box flexDirection="column">
      {/* 文件标题 */}
      {filePath && (
        <Box>
          <Text color="cyan" bold>── </Text>
          <Text color="cyan">{filePath}</Text>
          <Text color="cyan" bold> ──</Text>
        </Box>
      )}

      {/* 统计信息 */}
      <Box marginLeft={2} marginBottom={0}>
        {added > 0 && <Text color="green">+{added} </Text>}
        {removed > 0 && <Text color="red">-{removed} </Text>}
        <Text dimColor>({lines.length} 行变更)</Text>
      </Box>

      {/* 变更行 */}
      <Box flexDirection="column">
        {displayed.map((line: DiffLine, i: number) => (
          <DiffLineRenderer key={i} line={line} showLineNumbers={showLineNumbers} />
        ))}
      </Box>

      {lines.length > maxLines && (
        <Box marginLeft={2}>
          <Text dimColor>… ({lines.length - maxLines} 行更多变更)</Text>
        </Box>
      )}
    </Box>
  )
}

function DiffLineRenderer({ line, showLineNumbers }: { line: DiffLine; showLineNumbers: boolean }) {
  if (line.type === 'add') {
    return (
      <Box>
        {showLineNumbers ? (
          <>
            <Text dimColor>    </Text>
            <Text color="green" bold>{String(line.newLine || '').padStart(4)} + </Text>
          </>
        ) : (
          <Text color="green" bold>  + </Text>
        )}
        <Text color="green">{line.content}</Text>
      </Box>
    )
  }

  if (line.type === 'remove') {
    return (
      <Box>
        {showLineNumbers ? (
          <>
            <Text color="red" bold>{String(line.oldLine || '').padStart(4)} - </Text>
            <Text dimColor>    </Text>
          </>
        ) : (
          <Text color="red" bold>  - </Text>
        )}
        <Text color="red">{line.content}</Text>
      </Box>
    )
  }

  // context
  return (
    <Box>
      {showLineNumbers ? (
        <>
          <Text dimColor>{String(line.oldLine || '').padStart(4)} </Text>
          <Text dimColor>{String(line.newLine || '').padStart(4)}   </Text>
        </>
      ) : (
        <Text dimColor>    </Text>
      )}
      <Text dimColor>{line.content}</Text>
    </Box>
  )
}

// ─── 实时 Diff 预览（编辑过程中显示）───────────────────────────────────
interface StreamingDiffProps {
  oldText: string
  newText: string
  filePath?: string
  maxLines?: number
}

export function StreamingDiff({ oldText, newText, filePath, maxLines = 12 }: StreamingDiffProps) {
  // 每次 newText 变化时重新计算 diff
  const lines = computeDiff(oldText, newText, filePath)
  const recentLines = lines.slice(-maxLines)

  if (lines.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>(无变更)</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {filePath && (
        <Box marginLeft={2}>
          <Text color="cyan">✎ {filePath}</Text>
          <Text dimColor> ({lines.length} 行变更)</Text>
        </Box>
      )}
      {recentLines.map((line, i) => (
        <DiffLineRenderer key={i} line={line} showLineNumbers={true} />
      ))}
    </Box>
  )
}

// ─── 多文件 Diff 汇总 ─────────────────────────────────────────────────
interface MultiFileDiffProps {
  changes: Array<{ path: string; oldText: string; newText: string }>
  maxLinesPerFile?: number
}

export function MultiFileDiff({ changes, maxLinesPerFile = 8 }: MultiFileDiffProps) {
  let totalAdded = 0
  let totalRemoved = 0

  for (const change of changes) {
    const lines = computeDiff(change.oldText, change.newText, change.path)
    totalAdded += lines.filter(l => l.type === 'add').length
    totalRemoved += lines.filter(l => l.type === 'remove').length
  }

  return (
    <Box flexDirection="column">
      {/* 总计 */}
      <Box marginLeft={2} marginBottom={1}>
        <Text bold>📝 {changes.length} 个文件变更: </Text>
        {totalAdded > 0 && <Text color="green">+{totalAdded} </Text>}
        {totalRemoved > 0 && <Text color="red">-{totalRemoved}</Text>}
      </Box>

      {/* 每个文件的 diff */}
      {changes.map((change, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <DiffView
            oldText={change.oldText}
            newText={change.newText}
            filePath={change.path}
            maxLines={maxLinesPerFile}
          />
        </Box>
      ))}
    </Box>
  )
}
