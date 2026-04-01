// ─── 执行策略（Codex AskForApproval 风格）───────────────────────────────────
// Codex 的审批策略：
// - UnlessTrusted: 信任的命令自动执行，不信任的需要审批
// - OnFailure: 失败时才需要审批
// - OnRequest: 每次都需要审批
// - Never: 从不审批

export type ExecPolicy = 'unless-trusted' | 'on-failure' | 'on-request' | 'never'

export interface ExecResult {
  allowed: boolean
  autoApproved: boolean
  policy: ExecPolicy
  reason?: string
}

// 信任的命令集（Codex 风格）
const TRUSTED_COMMANDS = new Set([
  // 版本控制
  'git status', 'git log', 'git diff', 'git show', 'git branch', 'git tag',
  'git remote', 'git ls-files', 'git blame', 'git grep', 'git shortlog',
  'git add', 'git commit', 'git push', 'git pull', 'git fetch',
  // 文件查看
  'ls', 'pwd', 'date', 'whoami', 'id', 'env', 'which',
  // 系统信息
  'uname', 'hostname', 'df', 'du', 'free', 'uptime', 'ps',
  // 开发工具
  'node --version', 'npm --version', 'python --version', 'go version',
  'rustc --version', 'cargo --version',
])

// 不信任的命令（需要审批）
const UNTRUSTED_PATTERNS = [
  /rm\s/i,
  /sudo\s/i,
  /chmod\s/i,
  /chown\s/i,
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
  /mkfs\./i,
  /dd\s+if=/i,
  /systemctl\s/i,
  /service\s/i,
]

// 默认策略
let currentPolicy: ExecPolicy = 'unless-trusted'

export function setExecPolicy(policy: ExecPolicy) {
  currentPolicy = policy
}

export function getExecPolicy(): ExecPolicy {
  return currentPolicy
}

export function evaluateExecution(command: string): ExecResult {
  switch (currentPolicy) {
    case 'never':
      return { allowed: true, autoApproved: false, policy: 'never', reason: '策略：从不审批' }

    case 'on-request':
      return { allowed: false, autoApproved: false, policy: 'on-request', reason: '策略：每次都需要审批' }

    case 'on-failure':
      return { allowed: true, autoApproved: true, policy: 'on-failure', reason: '策略：失败时再审批' }

    case 'unless-trusted':
    default:
      // 信任的命令：自动执行
      const cmd = command.trim()
      for (const trusted of TRUSTED_COMMANDS) {
        if (cmd === trusted || cmd.startsWith(trusted + ' ')) {
          return { allowed: true, autoApproved: true, policy: 'unless-trusted', reason: '信任的命令' }
        }
      }

      // 不信任的命令：需要审批
      for (const pattern of UNTRUSTED_PATTERNS) {
        if (pattern.test(cmd)) {
          return { allowed: false, autoApproved: false, policy: 'unless-trusted', reason: '不信任的命令，需要审批' }
        }
      }

      // 其他命令：自动执行
      return { allowed: true, autoApproved: true, policy: 'unless-trusted', reason: '未知命令，自动执行' }
  }
}
