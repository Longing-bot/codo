import React from 'react'
import { Box, Text } from 'ink'
import type { Entry } from './MessageList.js'

// 缩短路径显示
function shortenPath(path: string, maxLen = 24): string {
  if (path.length <= maxLen) return path
  const parts = path.split('/')
  if (parts.length <= 2) return path.slice(-maxLen)
  return '~/' + parts.slice(-2).join('/')
}

export interface SidebarProps {
  entries: Entry[]
  changedFiles: { path: string; summary: string }[]
}

export function Sidebar({
  entries,
  changedFiles,
}: SidebarProps) {
  const toolCalls = entries.filter(e => e.type === 'tool').slice(-8)

  return (
    <Box flexDirection="column" width={30} borderStyle="single" borderColor="gray" paddingLeft={1} paddingRight={1}>
      <Text bold color="yellow">📋 侧边栏</Text>

      {changedFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>文件变更:</Text>
          {changedFiles.slice(0, 6).map((f, i) => (
            <Text key={i} dimColor>  {shortenPath(f.path, 24)}</Text>
          ))}
          {changedFiles.length > 6 && <Text dimColor>  ... 还有 {changedFiles.length - 6} 个</Text>}
        </Box>
      )}

      {toolCalls.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>工具调用:</Text>
          {toolCalls.map((t, i) => (
            <Text key={i} dimColor>  {t.toolName || '?'}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
