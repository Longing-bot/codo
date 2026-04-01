import React from 'react'
import { Box, Text } from 'ink'

export type EntryType = 'user' | 'assistant' | 'tool' | 'toolResult' | 'error' | 'system' | 'command' | 'approval'

export interface Entry {
  type: EntryType
  content: string
  toolName?: string
  toolArgs?: string
  timestamp?: number
}

export interface MessageListProps {
  entries: Entry[]
}

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
            <Box marginLeft={2}>
              <Text>{e.content}</Text>
            </Box>
          )}
          {e.type === 'tool' && (
            <Box marginLeft={2}>
              <Text color="blue">{'>'} </Text>
              <Text color="yellow">{e.content}</Text>
            </Box>
          )}
          {e.type === 'toolResult' && (
            <Box marginLeft={3}>
              <Text dimColor>│ </Text>
              <Text dimColor>{e.content}</Text>
            </Box>
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
