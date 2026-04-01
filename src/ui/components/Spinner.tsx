import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface SpinnerProps {
  status: string
  startTime: number
  turn: number
  toolName?: string   // 当前执行的工具名
}

// 工具 emoji 映射
function toolIcon(name?: string): string {
  if (!name) return ''
  const map: Record<string, string> = {
    read_file: '📖',
    write_file: '✏️',
    edit_file: '📝',
    patch_file: '🔧',
    bash: '⚡',
    glob: '🔍',
    grep: '🔎',
    web_search: '🌐',
    fetch: '📡',
    think: '💭',
    test_runner: '🧪',
    agent: '🤖',
  }
  return map[name] ? map[name] + ' ' : ''
}

export function Spinner({ status, startTime, turn, toolName }: SpinnerProps) {
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const iv = setInterval(() => {
      setFrame(f => (f + 1) % SPIN_FRAMES.length)
      setElapsed(Math.round((Date.now() - startTime) / 1000))
    }, 80)
    return () => clearInterval(iv)
  }, [startTime])

  const sec = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s`
    : `${elapsed}s`

  return (
    <Box marginLeft={2}>
      <Text color="cyan">{SPIN_FRAMES[frame]} </Text>
      {toolName && <Text color="yellow">{toolIcon(toolName)}</Text>}
      <Text color="cyan">{status}…</Text>
      {toolName && <Text dimColor> ({toolName})</Text>}
      <Text dimColor> {sec}</Text>
      {turn > 1 && <Text dimColor> · 第 {turn} 轮</Text>}
    </Box>
  )
}
