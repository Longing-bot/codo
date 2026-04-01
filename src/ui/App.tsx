import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { loadConfig, saveConfig, loadSession, getUsageTracker, formatUsd, estimateCost, detectProvider, type Message, type TokenUsage } from '../config/index.js'
import { runQuery } from '../query/index.js'
import { createREPLState } from '../repl/index.js'
import { processCommand, listCommands } from '../commands/index.js'
import { getContextStats } from '../memory/index.js'
import { collectContext, getContextSummary } from '../context/index.js'
import { getChangedFiles, getTrackerStats, formatChangeSummary, clearTracker } from '../tracker/index.js'
import { getApprovalMode, type ApprovalRequest, type ApprovalDecision } from '../approval/index.js'
import { addCommand, HistoryNavigator } from '../history/index.js'
import { getErrorMessage } from '../errors/index.js'

// 组件导入
import { StatusBar } from './components/StatusBar.js'
import { MessageList, type Entry, type EntryType } from './components/MessageList.js'
import { Spinner } from './components/Spinner.js'
import { InputBar, FooterBar } from './components/InputBar.js'
import { Sidebar } from './components/Sidebar.js'
import { ApprovalPanel } from './components/ApprovalPanel.js'

// Re-export types for backward compatibility
export type { Entry, EntryType }

interface Props { initialPrompt?: string }

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

// ─── Tab 补全建议 ──────────────────────────────────────────────────
function getCompletions(input: string): string[] {
  if (!input.startsWith('/')) return []
  const partial = input.slice(1).toLowerCase()
  const commands = listCommands()
  return commands
    .filter(c => c.name.startsWith(partial) || c.aliases?.some(a => a.startsWith(partial)))
    .map(c => `/${c.name}`)
    .slice(0, 8)
}

// ─── App ──────────────────────────────────────────────────────────────
export const App: React.FC<Props> = ({ initialPrompt }) => {
  const config = useMemo(() => loadConfig(), [])
  const { exit } = useApp()
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [turn, setTurn] = useState(0)
  const [turnStart, setTurnStart] = useState(Date.now())
  const [spinnerStatus, setSpinnerStatus] = useState('思考中')
  const [currentToolName, setCurrentToolName] = useState<string | undefined>(undefined)
  const [toolStartTime, setToolStartTime] = useState<number>(0)
  const [msgs, setMsgs] = useState<Message[]>(() => {
    const saved = loadSession()
    return saved.length > 0 ? saved : createREPLState().messages
  })
  // 审批状态
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [approvalResolve, setApprovalResolve] = useState<((value: ApprovalDecision) => void) | null>(null)
  // 侧边栏
  const [showSidebar, setShowSidebar] = useState(false)
  // Tab 补全
  const [completions, setCompletions] = useState<string[]>([])
  const [completionIndex, setCompletionIndex] = useState(-1)
  // 退出确认
  const [quitConfirm, setQuitConfirm] = useState(false)
  // 历史导航
  const historyNav = useRef(new HistoryNavigator())
  // Ctrl+R 搜索
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const add = useCallback((e: Entry) => setEntries(p => [...p, { ...e, timestamp: Date.now() }]), [])

  const submit = useCallback(async (text: string) => {
    if (!text.trim()) return

    addCommand(text.trim())

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
      setCompletions([])
      setCompletionIndex(-1)
      historyNav.current.reset()
      return
    }

    add({ type: 'user', content: text })
    setInput('')
    setCompletions([])
    setCompletionIndex(-1)
    historyNav.current.reset()
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
          setCurrentToolName(n)
          setToolStartTime(Date.now())
          if (n === 'bash' && isDangerousCommand(a)) {
            add({ type: 'tool', content: `[危险] ${n}(${a.length > 50 ? a.slice(0, 50) + '…' : a})`, toolName: n, toolArgs: a })
          } else {
            add({ type: 'tool', content: `${n}(${a.length > 50 ? a.slice(0, 50) + '…' : a})`, toolName: n, toolArgs: a })
          }
        },
        onToolResult: (n, r) => {
          const elapsed = toolStartTime > 0 ? Date.now() - toolStartTime : 0
          const lines = r.content.split('\n')
          if ((n === 'edit_file' || n === 'write_file') && !r.isError) {
            const match = r.content.match(/\[(\+\d+ -?\d* lines?)\]/)
            const summary = match ? match[1] : ''
            add({ type: 'toolResult', content: summary || lines[0].slice(0, 70), toolName: n, duration: elapsed, success: !r.isError })
          } else if (n === 'read_file' && !r.isError && lines.length > 1) {
            add({ type: 'toolResult', content: lines[0], toolName: n, duration: elapsed, success: !r.isError })
          } else if (n === 'bash' && !r.isError) {
            add({ type: 'toolResult', content: lines[0].slice(0, 70) || '(空输出)', toolName: n, duration: elapsed, success: !r.isError })
          } else {
            add({ type: 'toolResult', content: lines[0].slice(0, 70) || '(空输出)', toolName: n, duration: elapsed, success: !r.isError })
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
    } catch (ex: unknown) {
      add({ type: 'error', content: getErrorMessage(ex) })
    }
    setRunning(false)
  }, [config, msgs, add])

  const handleApprovalDecision = useCallback((decision: ApprovalDecision) => {
    approvalResolve?.(decision)
    setPendingApproval(null)
    setApprovalResolve(null)
    if (decision === 'no') {
      add({ type: 'error', content: '用户拒绝执行' })
    }
  }, [approvalResolve, add])

  // ─── 键盘快捷键 ──────────────────────────────────────────────────
  useInput((inputKey, key) => {
    // Ctrl+C：取消当前操作
    if (key.ctrl && inputKey === 'c') {
      if (running) {
        setRunning(false)
        add({ type: 'system', content: '⏹️ 操作已取消' })
        return
      }
      if (searchMode) {
        setSearchMode(false)
        setSearchQuery('')
        setInput('')
        return
      }
      setInput('')
      setCompletions([])
      return
    }

    // Ctrl+D：退出确认
    if (key.ctrl && inputKey === 'd') {
      if (quitConfirm) {
        exit()
      } else {
        setQuitConfirm(true)
        setTimeout(() => setQuitConfirm(false), 3000)
      }
      return
    }

    // Ctrl+L：清屏
    if (key.ctrl && inputKey === 'l') {
      setEntries([])
      return
    }

    // Ctrl+B：切换侧边栏
    if (key.ctrl && inputKey === 'b') {
      setShowSidebar(prev => !prev)
      return
    }

    // Ctrl+R：反向搜索历史
    if (key.ctrl && inputKey === 'r') {
      setSearchMode(true)
      setSearchQuery('')
      return
    }

    if (running || pendingApproval) return

    // 搜索模式
    if (searchMode) {
      if (key.return) {
        setSearchMode(false)
        setSearchQuery('')
        return
      }
      if (key.escape) {
        setSearchMode(false)
        setSearchQuery('')
        setInput('')
        return
      }
      if (key.backspace) {
        setSearchQuery(prev => prev.slice(0, -1))
        return
      }
      if (inputKey && !key.ctrl && !key.meta) {
        const newQuery = searchQuery + inputKey
        setSearchQuery(newQuery)
        const results = historyNav.current.search(newQuery)
        if (results.length > 0) {
          setInput(results[0])
        }
        return
      }
      return
    }

    // Tab：命令自动补全
    if (key.tab) {
      if (input.startsWith('/')) {
        const comps = getCompletions(input)
        if (comps.length > 0) {
          const nextIdx = (completionIndex + 1) % comps.length
          setCompletionIndex(nextIdx)
          setInput(comps[nextIdx] + ' ')
          setCompletions(comps)
        }
      }
      return
    }

    // 上下箭头：历史命令导航
    if (key.upArrow) {
      const prev = historyNav.current.getPrevious(input)
      if (prev !== null) setInput(prev)
      return
    }
    if (key.downArrow) {
      const next = historyNav.current.getNext()
      if (next !== null) setInput(next)
      return
    }

    // Shift+Enter：多行输入
    if (key.shift && key.return) {
      setInput(prev => prev + '\n')
      return
    }
  })

  useEffect(() => { if (initialPrompt) submit(initialPrompt) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = getContextStats(msgs)
  const context = collectContext()
  const contextSummary = getContextSummary(context)
  const trackerStats = getTrackerStats()
  const approvalMode = getApprovalMode()
  const changedFiles = getChangedFiles()
  const tracker = getUsageTracker()
  const totalCost = formatUsd(estimateCost(tracker.total, config.model))

  return (
    <Box flexDirection="column">
      {/* 状态栏 */}
      <StatusBar
        model={config.model}
        provider={detectProvider(config)}
        cwd={process.cwd()}
        tokenInfo={totalCost}
        changeCount={changedFiles.length}
        approvalMode={approvalMode}
      />

      <Box flexDirection="row">
        {/* 主面板 */}
        <Box flexDirection="column" flexGrow={1} padding={1}>
          {/* 搜索模式提示 */}
          {searchMode && (
            <Box marginBottom={1}>
              <Text color="yellow">🔍 反向搜索: {searchQuery || '(输入搜索词)'}</Text>
              <Text dimColor> · Enter 选择 · Esc 取消</Text>
            </Box>
          )}

          {/* 退出确认 */}
          {quitConfirm && (
            <Box marginBottom={1}>
              <Text color="yellow">再次 Ctrl+D 确认退出</Text>
            </Box>
          )}

          {/* Tab 补全提示 */}
          {completions.length > 0 && !searchMode && (
            <Box marginBottom={1}>
              <Text dimColor>{completions.join('  ')}</Text>
            </Box>
          )}

          {/* 消息列表 */}
          <MessageList entries={entries} />

          {/* Spinner */}
          {running && !pendingApproval && <Spinner turn={turn} startTime={turnStart} status={spinnerStatus} toolName={currentToolName} />}

          {/* Approval Panel */}
          {pendingApproval && (
            <ApprovalPanel
              request={pendingApproval}
              onDecision={handleApprovalDecision}
            />
          )}

          {/* 输入栏 */}
          {!running && !pendingApproval && (
            <InputBar
              value={input}
              onChange={(v) => {
                setInput(v)
                if (completions.length > 0) {
                  setCompletions([])
                  setCompletionIndex(-1)
                }
              }}
              onSubmit={submit}
              searchMode={searchMode}
            />
          )}

          {/* 底栏 */}
          <FooterBar visible={!running && !pendingApproval} />
        </Box>

        {/* 侧边栏 */}
        {showSidebar && (
          <Sidebar
            entries={entries}
            changedFiles={changedFiles.map(c => ({ path: c.path, summary: formatChangeSummary(c) }))}
          />
        )}
      </Box>
    </Box>
  )
}
