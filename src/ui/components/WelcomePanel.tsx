import React from 'react'
import { Box, Text, useInput } from 'ink'

interface Props {
  model: string
  provider: string
  cwd: string
  onContinue: () => void
}

export const WelcomePanel: React.FC<Props> = ({ model, provider, cwd, onContinue }) => {
  useInput(() => {
    onContinue()
  })

  const shortCwd = cwd.replace(process.env.HOME || '', '~')

  return (
    <Box flexDirection="column" padding={1}>
      {/* Main card */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        {/* Header */}
        <Box justifyContent="center" marginBottom={1}>
          <Text color="cyan" bold>🦞 edgecli v0.1.0</Text>
        </Box>

        {/* Welcome */}
        <Box justifyContent="center" marginBottom={1}>
          <Text bold>欢迎回来！</Text>
        </Box>

        {/* Model & CWD */}
        <Box flexDirection="column" alignItems="center">
          <Text color="yellow">{model}</Text>
          <Text dimColor>{shortCwd}</Text>
        </Box>
      </Box>

      {/* Tips card */}
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} marginTop={1}>
        <Box marginBottom={1}>
          <Text bold>💡 快速开始</Text>
        </Box>
        <Box>
          <Text dimColor>  直接输入文字开始对话</Text>
        </Box>
        <Box>
          <Text dimColor>  /help  查看所有命令</Text>
        </Box>
        <Box>
          <Text dimColor>  /clear 清空对话历史</Text>
        </Box>
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>按任意键继续…</Text>
      </Box>
    </Box>
  )
}
