// ─── Diff 显示组件（CC StructuredDiff 风格）─────────────────────────────────
import React from 'react'
import { Box, Text } from 'ink'
import { computeDiff, type DiffLine } from '../diff.js'

interface DiffViewProps {
  oldText: string
  newText: string
  filePath?: string
  maxLines?: number
}

export function DiffView({ oldText, newText, filePath, maxLines = 12 }: DiffViewProps) {
  const lines = computeDiff(oldText, newText, filePath)
  const displayed = lines.slice(0, maxLines)

  return (
    <Box flexDirection="column">
      {displayed.map((line: DiffLine, i: number) => (
        <Box key={i}>
          {line.type === 'add' && (
            <>
              <Text color="green">  {String(line.newLine || '').padStart(4)} + </Text>
              <Text color="green">{line.content}</Text>
            </>
          )}
          {line.type === 'remove' && (
            <>
              <Text color="red">{String(line.oldLine || '').padStart(4)} - </Text>
              <Text color="red">{line.content}</Text>
            </>
          )}
          {line.type === 'context' && (
            <>
              <Text dimColor>  {String(line.newLine || '').padStart(4)}   </Text>
              <Text dimColor>{line.content}</Text>
            </>
          )}
        </Box>
      ))}
      {lines.length > maxLines && (
        <Box>
          <Text dimColor>   … ({lines.length - maxLines} 行更多变更)</Text>
        </Box>
      )}
    </Box>
  )
}
