import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

export interface InputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder?: string
  searchMode?: boolean
}

export function InputBar({ value, onChange, onSubmit, placeholder, searchMode }: InputBarProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderColor="cyan" borderStyle="round" borderLeft={false} borderRight={false} borderBottom paddingLeft={1} paddingRight={1}>
        <Text color="green" bold>{'> '}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={searchMode ? '搜索历史...' : placeholder}
        />
      </Box>
    </Box>
  )
}

export interface FooterBarProps {
  visible: boolean
}

export function FooterBar({ visible }: FooterBarProps) {
  if (!visible) return null
  return (
    <Box marginTop={1} borderTop borderColor="gray" borderStyle="single" paddingLeft={1}>
      <Text dimColor>↑↓ 历史 · Tab 补全 · Ctrl+C 取消 · Ctrl+D 退出 · Ctrl+L 清屏 · Ctrl+B 侧边栏 · Ctrl+R 搜索</Text>
    </Box>
  )
}
