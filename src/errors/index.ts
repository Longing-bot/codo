// ─── 统一错误处理 ──────────────────────────────────────────────────────

/**
 * EdgeCLI 基础错误类
 */
export class EdgeCLIError extends Error {
  public readonly timestamp: number
  public readonly context?: Record<string, unknown>

  constructor(message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'EdgeCLIError'
    this.timestamp = Date.now()
    this.context = context
  }

  format(): string {
    return `${this.name}: ${this.message}`
  }
}

/**
 * API 调用错误
 */
export class APIError extends EdgeCLIError {
  public readonly statusCode?: number
  public readonly provider: string

  constructor(message: string, provider: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, context)
    this.name = 'APIError'
    this.provider = provider
    this.statusCode = statusCode
  }

  format(): string {
    const code = this.statusCode ? ` (HTTP ${this.statusCode})` : ''
    return `API 错误 [${this.provider}]: ${this.message}${code}`
  }
}

/**
 * 工具执行错误
 */
export class ToolError extends EdgeCLIError {
  public readonly toolName: string
  public readonly args?: string

  constructor(message: string, toolName: string, args?: string, context?: Record<string, unknown>) {
    super(message, context)
    this.name = 'ToolError'
    this.toolName = toolName
    this.args = args
  }

  format(): string {
    return `工具错误 [${this.toolName}]: ${this.message}`
  }
}

/**
 * 配置错误
 */
export class ConfigError extends EdgeCLIError {
  public readonly configKey?: string

  constructor(message: string, configKey?: string, context?: Record<string, unknown>) {
    super(message, context)
    this.name = 'ConfigError'
    this.configKey = configKey
  }

  format(): string {
    const key = this.configKey ? ` (${this.configKey})` : ''
    return `配置错误${key}: ${this.message}`
  }
}

/**
 * 权限错误
 */
export class PermissionError extends EdgeCLIError {
  public readonly toolName: string
  public readonly requiredLevel: string
  public readonly currentLevel: string

  constructor(message: string, toolName: string, requiredLevel: string, currentLevel: string) {
    super(message)
    this.name = 'PermissionError'
    this.toolName = toolName
    this.requiredLevel = requiredLevel
    this.currentLevel = currentLevel
  }

  format(): string {
    return `权限不足 [${this.toolName}]: 需要 ${this.requiredLevel}，当前 ${this.currentLevel}`
  }
}

/**
 * LSP 错误
 */
export class LSPError extends EdgeCLIError {
  public readonly language: string

  constructor(message: string, language: string, context?: Record<string, unknown>) {
    super(message, context)
    this.name = 'LSPError'
    this.language = language
  }

  format(): string {
    return `LSP 错误 [${this.language}]: ${this.message}`
  }
}

/**
 * MCP 错误
 */
export class MCPError extends EdgeCLIError {
  public readonly serverName: string

  constructor(message: string, serverName: string, context?: Record<string, unknown>) {
    super(message, context)
    this.name = 'MCPError'
    this.serverName = serverName
  }

  format(): string {
    return `MCP 错误 [${this.serverName}]: ${this.message}`
  }
}

/**
 * 统一错误格式化
 */
export function formatError(error: unknown): string {
  if (error instanceof EdgeCLIError) {
    return error.format()
  }
  if (error instanceof Error) {
    return `错误: ${error.message}`
  }
  return `未知错误: ${String(error)}`
}

/**
 * 安全地提取错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
