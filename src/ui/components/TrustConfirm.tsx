import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface Props {
  cwd: string
  onAccept: () => void
  onReject: () => void
}

export const TrustConfirm: React.FC<Props> = ({ cwd, onAccept, onReject }) => {
  const [selected, setSelected] = useState(0)

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) setSelected(s => s === 0 ? 1 : 0)
    if (key.return) selected === 0 ? onAccept() : onReject()
    if (key.escape) onReject()
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>edgecli</Text>
      </Box>

      {/* Separator */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>

      {/* Workspace info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>当前工作目录：</Text>
        <Text bold> {cwd}</Text>
      </Box>

      {/* Safety notice */}
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>edgecli 可以读取、编辑和执行此目录下的文件。</Text>
        <Text dimColor>请确认这是你信任的项目目录，否则请先检查文件内容。</Text>
      </Box>

      {/* Options */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={selected === 0 ? 'cyan' : 'gray'}>
          {selected === 0 ? '❯ ' : '  '}1. 是，我信任此目录
        </Text>
        <Text color={selected === 1 ? 'cyan' : 'gray'}>
          {selected === 1 ? '❯ ' : '  '}2. 否，退出
        </Text>
      </Box>

      {/* Hint */}
      <Box>
        <Text dimColor>方向键选择 · Enter 确认 · Esc 取消</Text>
      </Box>
    </Box>
  )
}
