// ─── 模型路由（参考 Plandex 的 Model Pack）────────────────────────────────
// 不同任务用不同模型（省钱+提效）

import { CodoConfig, loadConfig, saveConfig } from '../config/index.js'

// ─── 类型定义 ──────────────────────────────────────────────────────────
export type TaskCategory = 'plan' | 'edit' | 'search' | 'chat' | 'code' | 'default'

export interface ModelRoute {
  plan: string
  edit: string
  search: string
  chat: string
  code: string
  default: string
}

export interface RouterConfig {
  enabled: boolean
  routes: ModelRoute
  fallbackModel: string
}

// ─── 默认路由 ─────────────────────────────────────────────────────────
const DEFAULT_ROUTES: ModelRoute = {
  plan: 'claude-sonnet-4-20250514',
  edit: 'gpt-4o',
  search: 'gpt-4o-mini',
  chat: 'gpt-4o-mini',
  code: 'gpt-4o',
  default: 'gpt-4o-mini',
}

// ─── 任务分类关键词 ───────────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  plan: ['plan', '规划', '步骤', '架构', '设计', '方案', '重构'],
  edit: ['edit', '修改', '改', '修复', 'fix', 'update', 'update file', 'write_file', 'edit_file', 'patch_file'],
  search: ['search', 'find', '查找', '搜索', 'grep', 'glob', '哪里'],
  chat: ['what', 'how', 'why', '是什么', '怎么', '为什么', 'explain', '解释'],
  code: ['code', '写', '实现', 'implement', 'create', 'build', '函数'],
  default: [],
}

// ─── 路由逻辑 ─────────────────────────────────────────────────────────
let routerConfig: RouterConfig | null = null

export function getRouterConfig(): RouterConfig {
  if (routerConfig) return routerConfig

  // 从配置文件加载
  try {
    const config = loadConfig()
    const extended = config as any
    if (extended.modelRouter) {
      routerConfig = {
        enabled: extended.modelRouter.enabled !== false,
        routes: { ...DEFAULT_ROUTES, ...extended.modelRouter.routes },
        fallbackModel: config.model,
      }
      return routerConfig
    }
  } catch {}

  routerConfig = {
    enabled: false,
    routes: DEFAULT_ROUTES,
    fallbackModel: '',
  }
  return routerConfig
}

export function setRouterConfig(cfg: Partial<RouterConfig>): void {
  const current = getRouterConfig()
  routerConfig = { ...current, ...cfg }

  // 保存到配置文件
  try {
    const config = loadConfig()
    ;(config as any).modelRouter = {
      enabled: routerConfig.enabled,
      routes: routerConfig.routes,
    }
    saveConfig(config)
  } catch {}
}

export function classifyTask(userMessage: string, toolCalls?: string[]): TaskCategory {
  const msg = userMessage.toLowerCase()

  // 根据工具调用分类
  if (toolCalls) {
    if (toolCalls.some(t => t === 'write_file' || t === 'edit_file' || t === 'patch_file')) {
      return 'edit'
    }
    if (toolCalls.some(t => t === 'grep' || t === 'glob' || t === 'read_file')) {
      return 'search'
    }
    if (toolCalls.some(t => t === 'bash')) {
      return 'code'
    }
  }

  // 根据消息内容分类
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => msg.includes(kw))) {
      return category as TaskCategory
    }
  }

  return 'default'
}

export function routeModel(userMessage: string, toolCalls?: string[]): string | null {
  const cfg = getRouterConfig()
  if (!cfg.enabled) return null

  const category = classifyTask(userMessage, toolCalls)
  const model = cfg.routes[category] || cfg.fallbackModel

  if (!model) return null
  return model
}

// ─── 配置管理 ─────────────────────────────────────────────────────────
export function enableRouter(): void {
  setRouterConfig({ enabled: true })
}

export function disableRouter(): void {
  setRouterConfig({ enabled: false })
}

export function setRoute(category: TaskCategory, model: string): void {
  const cfg = getRouterConfig()
  cfg.routes[category] = model
  setRouterConfig({ routes: cfg.routes })
}

// ─── 格式化 ──────────────────────────────────────────────────────────
export function formatRouterStatus(): string {
  const cfg = getRouterConfig()
  if (!cfg.enabled) return '模型路由: 未启用（使用默认模型）\n\n启用: /router enable'

  const lines = ['模型路由: ✅ 已启用\n']
  for (const [category, model] of Object.entries(cfg.routes)) {
    lines.push(`  ${category}: ${model}`)
  }
  lines.push(`\n修改: /router set <category> <model>`)
  lines.push(`禁用: /router disable`)

  return lines.join('\n')
}
