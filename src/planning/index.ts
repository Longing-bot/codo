// ─── 多文件规划模式（参考 Plandex）────────────────────────────────────────
// 复杂任务先规划再执行，用户确认后按步骤执行

// ─── 类型定义 ──────────────────────────────────────────────────────────
export interface PlanStep {
  step: number
  filesToModify: string[]
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  result?: string
}

export interface ExecutionPlan {
  id: string
  task: string
  steps: PlanStep[]
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed'
  currentStep: number
  createdAt: number
  updatedAt: number
}

// ─── Plan 管理 ────────────────────────────────────────────────────────
let currentPlan: ExecutionPlan | null = null

function generatePlanId(): string {
  return 'plan-' + Date.now().toString(36)
}

/**
 * 从 LLM 返回中解析计划
 * 期望格式：
 * ```json
 * [
 *   {"step": 1, "files": ["src/auth.ts"], "description": "修改认证逻辑"},
 *   {"step": 2, "files": ["src/api.ts"], "description": "更新 API 调用"}
 * ]
 * ```
 */
export function parsePlanFromLLM(task: string, llmResponse: string): ExecutionPlan | null {
  try {
    // 尝试从 JSON 代码块中提取
    const jsonMatch = llmResponse.match(/```json\s*\n?([\s\S]*?)\n?```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : llmResponse

    // 尝试找到 JSON 数组
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return null

    const raw = JSON.parse(arrayMatch[0])
    if (!Array.isArray(raw)) return null

    const steps: PlanStep[] = raw.map((item: any, idx: number) => ({
      step: item.step || idx + 1,
      filesToModify: item.files || item.filesToModify || [],
      description: item.description || item.desc || `Step ${idx + 1}`,
      status: 'pending' as const,
    }))

    if (steps.length === 0) return null

    const plan: ExecutionPlan = {
      id: generatePlanId(),
      task,
      steps,
      status: 'draft',
      currentStep: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    currentPlan = plan
    return plan
  } catch {
    return null
  }
}

export function createPlan(task: string, steps: { filesToModify: string[]; description: string }[]): ExecutionPlan {
  const plan: ExecutionPlan = {
    id: generatePlanId(),
    task,
    steps: steps.map((s, idx) => ({
      step: idx + 1,
      filesToModify: s.filesToModify,
      description: s.description,
      status: 'pending',
    })),
    status: 'draft',
    currentStep: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  currentPlan = plan
  return plan
}

export function getCurrentPlan(): ExecutionPlan | null {
  return currentPlan
}

export function confirmPlan(): boolean {
  if (!currentPlan || currentPlan.status !== 'draft') return false
  currentPlan.status = 'confirmed'
  currentPlan.updatedAt = Date.now()
  return true
}

export function cancelPlan(): void {
  currentPlan = null
}

export function reviseStep(stepNum: number, newDescription: string): boolean {
  if (!currentPlan) return false
  const step = currentPlan.steps.find(s => s.step === stepNum)
  if (!step) return false
  step.description = newDescription
  currentPlan.updatedAt = Date.now()
  return true
}

// ─── 执行管理 ─────────────────────────────────────────────────────────
export function startExecution(): PlanStep | null {
  if (!currentPlan || currentPlan.status !== 'confirmed') return null
  currentPlan.status = 'executing'
  currentPlan.currentStep = 0
  return nextStep()
}

export function nextStep(): PlanStep | null {
  if (!currentPlan) return null

  // 找下一个 pending 的步骤
  const pending = currentPlan.steps.find(s => s.status === 'pending')
  if (!pending) {
    // 所有步骤完成
    const allCompleted = currentPlan.steps.every(s => s.status === 'completed' || s.status === 'skipped')
    currentPlan.status = allCompleted ? 'completed' : 'failed'
    currentPlan.updatedAt = Date.now()
    return null
  }

  pending.status = 'in_progress'
  currentPlan.currentStep = pending.step
  currentPlan.updatedAt = Date.now()
  return pending
}

export function completeStep(stepNum: number, result?: string): void {
  if (!currentPlan) return
  const step = currentPlan.steps.find(s => s.step === stepNum)
  if (!step) return
  step.status = 'completed'
  step.result = result
  currentPlan.updatedAt = Date.now()
}

export function failStep(stepNum: number, error: string): void {
  if (!currentPlan) return
  const step = currentPlan.steps.find(s => s.step === stepNum)
  if (!step) return
  step.status = 'failed'
  step.result = error
  currentPlan.updatedAt = Date.now()
}

export function skipStep(stepNum: number): void {
  if (!currentPlan) return
  const step = currentPlan.steps.find(s => s.step === stepNum)
  if (!step) return
  step.status = 'skipped'
  currentPlan.updatedAt = Date.now()
}

// ─── 格式化 ──────────────────────────────────────────────────────────
export function formatPlan(plan: ExecutionPlan): string {
  const lines: string[] = []
  const statusIcon = {
    draft: '📝',
    confirmed: '✅',
    executing: '🔄',
    completed: '🎉',
    failed: '❌',
  }[plan.status] || '?'

  lines.push(`${statusIcon} 计划: ${plan.task}`)
  lines.push(`状态: ${plan.status}  步骤: ${plan.steps.length}`)
  lines.push('')

  for (const step of plan.steps) {
    const icon = {
      pending: '  ',
      in_progress: '▶️',
      completed: '✅',
      failed: '❌',
      skipped: '⏭️',
    }[step.status] || '  '

    const progress = plan.status === 'executing'
      ? ` (Step ${plan.currentStep}/${plan.steps.length})`
      : ''

    lines.push(`${icon} Step ${step.step}: ${step.description}`)
    if (step.filesToModify.length > 0) {
      lines.push(`    文件: ${step.filesToModify.join(', ')}`)
    }
    if (step.result) {
      lines.push(`    结果: ${step.result.slice(0, 80)}`)
    }
  }

  return lines.join('\n')
}

export function formatPlanProgress(plan: ExecutionPlan): string {
  const completed = plan.steps.filter(s => s.status === 'completed').length
  const total = plan.steps.length
  const pct = Math.round((completed / total) * 100)

  const current = plan.steps.find(s => s.status === 'in_progress')
  const progressLine = current
    ? `Step ${current.step}/${total}: ${current.description}`
    : `${completed}/${total} steps completed`

  return `[${pct}%] ${progressLine}`
}
