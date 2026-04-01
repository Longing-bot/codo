import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ApprovalRequest, ApprovalDecision } from '../../approval/index.js'

export interface ApprovalPanelProps {
  request: ApprovalRequest
  onDecision: (decision: ApprovalDecision) => void
}

const OPTIONS: { label: string; value: ApprovalDecision }[] = [
  { label: '允许执行', value: 'yes' },
  { label: '本次会话始终允许', value: 'always' },
  { label: '拒绝', value: 'no' },
]

export function ApprovalPanel({ request, onDecision }: ApprovalPanelProps) {
  const [focus, setFocus] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) setFocus(f => (f - 1 + OPTIONS.length) % OPTIONS.length)
    if (key.downArrow) setFocus(f => (f + 1) % OPTIONS.length)
    if (key.return) onDecision(OPTIONS[focus].value)
    if (key.escape) onDecision('no')
  })

  const toolColor = request.isDestructive ? 'red' : 'yellow'

  return (
    <Box flexDirection="column" borderColor={toolColor} borderStyle="round" borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>
      <Box paddingX={1}>
        <Text color={toolColor} bold>审批: {request.description}</Text>
        <Text dimColor> ({request.toolName})</Text>
      </Box>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Text color="white" bold>{'❯ '}{request.argsSummary}</Text>
        {request.isDestructive && <Text color="red">⚠️ 此操作可能是破坏性的</Text>}
      </Box>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={opt.value}>
            <Text color={i === focus ? 'cyan' : 'gray'}>
              {i === focus ? '● ' : '○ '}
            </Text>
            <Text color={i === focus ? 'cyan' : 'gray'} bold={i === focus}>
              {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Box paddingX={1} paddingTop={1}>
        <Text dimColor>↑↓ 选择 · Enter 确认 · Esc 取消</Text>
      </Box>
    </Box>
  )
}
