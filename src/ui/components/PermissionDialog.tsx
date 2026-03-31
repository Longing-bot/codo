// ─── 权限审批对话框（CC PermissionDialog 照搬）─────────────────────────────
import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

interface PermissionDialogProps {
  title: string
  subtitle?: string
  command: string
  description?: string
  onAccept: () => void
  onReject: () => void
}

const OPTIONS = [
  { label: '允许执行', value: 'yes' },
  { label: '拒绝', value: 'no' },
]

export function PermissionDialog({ title, subtitle, command, description, onAccept, onReject }: PermissionDialogProps) {
  const [focus, setFocus] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) setFocus(f => (f - 1 + OPTIONS.length) % OPTIONS.length)
    if (key.downArrow) setFocus(f => (f + 1) % OPTIONS.length)
    if (key.return) {
      if (OPTIONS[focus].value === 'yes') onAccept()
      else onReject()
    }
    if (key.escape) onReject()
  })

  return (
    <Box flexDirection="column" borderColor="yellow" borderStyle="round" borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>
      {/* Title bar */}
      <Box paddingX={1}>
        <Text color="yellow" bold>{title}</Text>
        {subtitle && <Text dimColor> {subtitle}</Text>}
      </Box>

      {/* Command preview */}
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Text color="white" bold>{'❯ '}{command}</Text>
        {description && <Text dimColor>{description}</Text>}
      </Box>

      {/* Options */}
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

      {/* Hint */}
      <Box paddingX={1} paddingTop={1}>
        <Text dimColor>↑↓ 选择 · Enter 确认 · Esc 取消</Text>
      </Box>
    </Box>
  )
}
