// ─── 待办工具（CC TodoWriteTool 风格）────────────────────────────────────────
import type { Tool } from './index.js'

interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority?: 'high' | 'medium' | 'low'
}

// 会话级待办列表
let todos: Todo[] = []

export function getTodos(): Todo[] { return todos }

export function clearTodos() { todos = [] }

export const todoTool: Tool = {
  name: 'todo_write',
  description: `管理任务列表，追踪多步骤工作的进度。

CC 风格使用说明：
- 复杂任务（3+ 步骤）必须使用此工具
- 开始工作前标记为 in_progress
- 完成后标记为 completed
- 一次只有一个 in_progress 任务
- 发现新任务时添加到列表

使用场景：
- 用户提供了多个任务（列表或逗号分隔）
- 需要多步操作的非平凡任务
- 用户明确要求使用待办列表

不使用场景：
- 单个简单任务
- 纯对话或信息查询`,
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '更新后的任务列表',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID' },
            content: { type: 'string', description: '任务描述' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '状态' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级' },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  execute: async (args) => {
    const oldTodos = [...todos]
    todos = args.todos || []

    // 格式化输出
    const lines = todos.map(t => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'
      const priority = t.priority === 'high' ? '🔴' : t.priority === 'low' ? '🟢' : '🟡'
      return `${icon} ${priority} ${t.content}`
    })

    const completed = todos.filter(t => t.status === 'completed').length
    const total = todos.length
    const progress = total > 0 ? Math.round(completed / total * 100) : 0

    return {
      content: `📋 任务列表 (${completed}/${total} 完成, ${progress}%)\n${lines.join('\n')}`,
      isError: false,
    }
  },
}
