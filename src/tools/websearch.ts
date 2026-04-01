// ─── Web 搜索工具（CC WebSearchTool 风格）────────────────────────────────────
import type { Tool } from './index.js'

export const webSearchTool: Tool = {
  name: 'web_search',
  description: `搜索互联网获取最新信息。

CC 风格使用说明：
- 当知识截止日期后需要最新信息时使用
- 搜索结果包含标题、URL、摘要
- 必须在回答后列出信息来源
- 使用当前年份搜索最新信息

使用场景：
- 用户询问当前事件、最新文档
- 需要验证或补充现有知识
- 查找特定 API 或库的最新信息

不使用场景：
- 常识性问题（模型已有答案）
- 项目内的代码搜索（用 grep）`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      count: { type: 'integer', default: 5, description: '结果数量 (1-10)' },
      country: { type: 'string', description: '国家代码如 cn/us' },
      search_lang: { type: 'string', description: '搜索语言如 zh/en' },
    },
    required: ['query'],
  },
  execute: async (args: Record<string, any>) => {
    try {
      const params = new URLSearchParams({
        q: args.query,
        count: String(args.count || 5),
      })
      if (args.country) params.set('country', args.country)
      if (args.search_lang) params.set('search_lang', args.search_lang)

      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY || '',
        },
      })

      if (!res.ok) {
        // 降级到 DuckDuckGo
        return await searchDuckDuckGo(args.query, args.count || 5)
      }

      const data = await res.json() as any
      const results = (data.web?.results || []).slice(0, args.count || 5)

      if (!results.length) {
        return { content: `未找到 "${args.query}" 的结果。`, isError: false }
      }

      const formatted = results.map((r: any, i: number) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || ''}`
      ).join('\n\n')

      const sources = results.map((r: any) => `- [${r.title}](${r.url})`).join('\n')

      return {
        content: `${formatted}\n\n**来源：**\n${sources}`,
        isError: false,
      }
    } catch (ex: any) {
      return await searchDuckDuckGo(args.query, args.count || 5)
    }
  },
}

// DuckDuckGo 降级搜索
async function searchDuckDuckGo(query: string, count: number) {
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)
    const data = await res.json() as any

    const results = (data.RelatedTopics || []).slice(0, count)

    if (!results.length) {
      return { content: `未找到 "${query}" 的结果。`, isError: false }
    }

    const formatted = results.map((r: any, i: number) =>
      `${i + 1}. ${r.Text || r.FirstURL || ''}`
    ).join('\n\n')

    return { content: formatted, isError: false }
  } catch {
    return { content: `搜索 "${query}" 失败。请检查网络连接。`, isError: true }
  }
}
