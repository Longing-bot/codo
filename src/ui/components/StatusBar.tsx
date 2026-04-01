import React from 'react'
import { Box, Text } from 'ink'

// 缩短路径显示
function shortenPath(path: string, maxLen = 30): string {
  if (path.length <= maxLen) return path
  const parts = path.split('/')
  if (parts.length <= 2) return path.slice(-maxLen)
  return '~/' + parts.slice(-2).join('/')
}

export interface StatusBarProps {
  model: string
  provider: string
  cwd: string
  tokenInfo: string
  changeCount: number
  approvalMode: string
}

export function StatusBar({
  model,
  provider,
  cwd,
  tokenInfo,
  changeCount,
}: StatusBarProps) {
  const left = `${model} (${provider})`
  const center = shortenPath(cwd)
  const right = `${tokenInfo}${changeCount > 0 ? ` · 📝${changeCount}` : ''}`

  return (
    <Box borderStyle="single" borderColor="gray" borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0} paddingBottom={0}>
      <Box width="33%">
        <Text color="cyan" bold>{left}</Text>
      </Box>
      <Box width="34%" justifyContent="center">
        <Text dimColor>{center}</Text>
      </Box>
      <Box width="33%" justifyContent="flex-end">
        <Text dimColor>{right}</Text>
      </Box>
    </Box>
  )
}
