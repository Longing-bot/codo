import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { loadConfig, saveConfig, loadSession, getUsageTracker, formatUsd, estimateCost, type Message, type TokenUsage } from '../config/index.js'
import { runQuery } from '../query/index.js'
import { createREPLState } from '../repl/index.js'
import { processCommand } from '../commands/index.js'
import { getContextStats } from '../memory/index.js'
import { collectContext, getContextSummary } from '../context/index.js'
import { getChangedFiles, getTrackerStats, formatChangeSummary, clearTracker } from '../tracker/index.js'
import { getApprovalMode, setApprovalMode, type ApprovalRequest, type ApprovalDecision } from '../approval/index.js'
import { PermissionDialog } from './components/PermissionDialog.js'

interface Props { initialPrompt?: string }

type EntryType = 'user' | 'assistant' | 'tool' | 'toolResult' | 'error' | 'system' | 'command' | 'approval'
interface Entry {
  type: EntryType
  content: string
  toolName?: string
  toolArgs?: string
  timestamp?: number
}

// ─── Spinner ────────────────────────────────────────────────────────
const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function Spinner({ status, startTime, turn }: { status: string; startTime: number; turn: number }) {
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
      <Text color="cyan">{status}…</Text>
      <Text dimColor> {sec}</Text>
      {turn > 1 && <Text dimColor> · 第 {turn} 轮</Text>}
    </Box>
  )
}

// 工具名 → 状态文案
function toolStatus(name: string): string {
  const map: Record<string, string> = {
    bash: '执行中',
    read_file: '读取中',
    write_file: '写入中',
    edit_file: '编辑中',
    glob: '搜索中',
    grep: '搜索中',
    web_search: '搜索中',
    fetch: '请求中',
    todo: '处理中',
  }
  return map[name] || '执行中'
}

// ─── 危险命令检测 ─────────────────────────────────────────────────────
const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-z]*f|--force|--recursive)\s/i,
  /rm\s+-rf\s/i,
  />\s*\/dev\//i,
  /mkfs\./i,
  /dd\s+if=/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i,
  /chmod\s+777\s/i,
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
]

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command))
}

// ─── Approval Panel（3 选项：Yes / No / Always）─────────────────────
function ApprovalPanel({
  request,
  onDecision,
}: {
  request: ApprovalRequest
  onDecision: (decision: ApprovalDecision) => void
}) {
  const [focus, setFocus] = useState(0)
  const options: { label: string; value: ApprovalDecision }[] = [
    { label: '允许执行', value: 'yes' },
    { label: '本次会话始终允许', value: 'always' },
    { label: '拒绝', value: 'no' },
  ]

  useInput((input, key) => {
    if (key.upArrow) setFocus(f => (f - 1 + options.length) % options.length)
    if (key.downArrow) setFocus(f => (f + 1) % options.length)
    if (key.return) onDecision(options[focus].value)
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
        {options.map((opt, i) => (
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

// ─── App ──────────────────────────────────────────────────────────────
export const App: React.FC<Props> = ({ initialPrompt }) => {
  const config = loadConfig()
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [turn, setTurn] = useState(0)
  const [turnStart, setTurnStart] = useState(Date.now())
  const [spinnerStatus, setSpinnerStatus] = useState('思考中')
  const [msgs, setMsgs] = useState<Message[]>(() => {
    const saved = loadSession()
    return saved.length > 0 ? saved : createREPLState().messages
  })
  // 审批状态
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [approvalResolve, setApprovalResolve] = useState<((value: ApprovalDecision) => void) | null>(null)
  // 输入历史
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [savedInput, setSavedInput] = useState('')

  const add = useCallback((e: Entry) => setEntries(p => [...p, { ...e, timestamp: Date.now() }]), [])

  const submit = useCallback(async (text: string) => {
    if (!text.trim()) return

    const cmd = await processCommand(text.trim(), {
      messages: msgs,
      clearMessages: () => setMsgs([]),
    })
    if (cmd) {
      add({ type: 'command', content: cmd.content })
      if (cmd.clearHistory) {
        setMsgs([])
        clearTracker()
      }
      setInput('')
      return
    }

    add({ type: 'user', content: text })
    setInput('')
    setHistory(h => [text, ...h].slice(0, 50))
    setHistoryIndex(-1)
    setRunning(true)
    setTurn(0)
    setTurnStart(Date.now())

    try {
      const updated = await runQuery(text, config, [...msgs], {
        onToken: t => {
          setSpinnerStatus('思考中')
          setEntries(prev => {
            const last = prev[prev.length - 1]
            if (last?.type === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + t }]
            }
            return [...prev, { type: 'assistant', content: t }]
          })
        },
        onToolStart: (n, a) => {
          setSpinnerStatus(toolStatus(n))
          if (n === 'bash' && isDangerousCommand(a)) {
            add({ type: 'tool', content: `[危险] ${n}(${a.length > 50 ? a.slice(0, 50) + '…' : a})`, toolName: n, toolArgs: a })
          } else {
            add({ type: 'tool', content: `${n}(${a.length > 50 ? a.slice(0, 50) + '…' : a})`, toolName: n, toolArgs: a })
          }
        },
        onToolResult: (n, r) => {
          const lines = r.content.split('\n')
          // 文件编辑：显示变更摘要
          if ((n === 'edit_file' || n === 'write_file') && !r.isError) {
            // 提取 [+N -M lines] 摘要
            const match = r.content.match(/\[(\+\d+ -?\d* lines?)\]/)
            const summary = match ? match[1] : ''
            add({ type: 'toolResult', content: summary || lines[0].slice(0, 70) })
          } else if (n === 'read_file' && !r.isError && lines.length > 1) {
            add({ type: 'toolResult', content: lines[0] })
          } else if (n === 'bash' && !r.isError) {
            add({ type: 'toolResult', content: lines[0].slice(0, 70) || '(空输出)' })
          } else {
            add({ type: 'toolResult', content: lines[0].slice(0, 70) || '(空输出)' })
          }
          if (lines.length > 1 && n !== 'read_file') {
            add({ type: 'system', content: `(${lines.length} 行输出)` })
          }
        },
        onTurn: t => {
          setTurn(t)
          setTurnStart(Date.now())
        },
        onUsage: (usage: TokenUsage, model: string) => {
          const turnCost = estimateCost(usage, model)
          const tracker = getUsageTracker()
          add({
            type: 'system',
            content: `📊 tok: ${usage.input_tokens}→${usage.output_tokens}  缓存读:${usage.cache_read_input_tokens}  ${formatUsd(turnCost)} (累计 ${formatUsd(estimateCost(tracker.total, model))})`,
          })
        },
        onError: e => add({ type: 'error', content: e }),
        onApprovalNeeded: (request: ApprovalRequest): Promise<ApprovalDecision> => {
          return new Promise<ApprovalDecision>(resolve => {
            setPendingApproval(request)
            setApprovalResolve(() => resolve)
          })
        },
      })
      setMsgs(updated)
    } catch (ex: any) {
      add({ type: 'error', content: ex.message })
    }
    setRunning(false)
  }, [config, msgs, add])

  // 审批回调
  const handleApprovalDecision = useCallback((decision: ApprovalDecision) => {
    approvalResolve?.(decision)
    setPendingApproval(null)
    setApprovalResolve(null)
    if (decision === 'no') {
      add({ type: 'error', content: '用户拒绝执行' })
    }
  }, [approvalResolve, add])

  useInput((input, key) => {
    if (key.ctrl && input === 'c' && running) setRunning(false)
    if (key.upArrow && !running && !pendingApproval) {
      if (historyIndex === -1) setSavedInput(input)
      const next = Math.min(historyIndex + 1, history.length - 1)
      if (next >= 0) {
        setHistoryIndex(next)
        setInput(history[next])
      }
    }
    if (key.downArrow && !running && !pendingApproval) {
      if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1)
        setInput(history[historyIndex - 1])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setInput(savedInput)
      }
    }
    if (key.shift && key.return && !running && !pendingApproval) {
      setInput(prev => prev + '\n')
    }
  })

  useEffect(() => { if (initialPrompt) submit(initialPrompt) }, [])

  const stats = getContextStats(msgs)
  const context = collectContext()
  const contextSummary = getContextSummary(context)
  const trackerStats = getTrackerStats()
  const approvalMode = getApprovalMode()

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold color="cyan">edgecli</Text>
          <Text dimColor> {config.model}</Text>
          <Text dimColor> · {approvalMode}</Text>
        </Box>
        <Text dimColor>{stats} · {contextSummary}</Text>
        {trackerStats !== '没有文件变更' && (
          <Text color="yellow">📝 {trackerStats}</Text>
        )}
      </Box>

      {/* Messages */}
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

      {/* Spinner */}
      {running && !pendingApproval && <Spinner turn={turn} startTime={turnStart} status={spinnerStatus} />}

      {/* Approval Panel */}
      {pendingApproval && (
        <ApprovalPanel
          request={pendingApproval}
          onDecision={handleApprovalDecision}
        />
      )}

      {/* Input box */}
      {!running && !pendingApproval && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderColor="cyan" borderStyle="round" borderLeft={false} borderRight={false} borderBottom paddingLeft={1} paddingRight={1}>
            <Text color="green" bold>{'> '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={submit}
              placeholder=""
            />
          </Box>
        </Box>
      )}

      {/* Footer */}
      {!running && !pendingApproval && (
        <Box marginTop={1} borderTop borderColor="gray" borderStyle="single" paddingLeft={1}>
          <Text dimColor>{config.model}</Text>
          <Text dimColor> · </Text>
          <Text dimColor>{getContextStats(msgs)}</Text>
          <Text dimColor> · </Text>
          <Text dimColor>/help</Text>
          <Text dimColor> · </Text>
          <Text dimColor>/clear</Text>
          <Text dimColor> · </Text>
          <Text dimColor>/quit</Text>
        </Box>
      )}
    </Box>
  )
}
