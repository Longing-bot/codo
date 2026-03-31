// ─── Interactive Setup ─────────────────────────────────────────────────────
import { createInterface } from 'readline'
import { join } from 'path'
import { homedir } from 'os'
import { loadConfig, saveConfig, type CodoConfig } from '../config/index.js'

const PROVIDERS = [
  { name: 'OpenAI', base: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], provider: 'openai' as const },
  { name: 'Anthropic', base: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-haiku-4-5-20251001'], provider: 'anthropic' as const },
  { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'meta-llama/llama-3-70b'], provider: 'openrouter' as const },
  { name: 'LongCat (free)', base: 'https://api.longcat.chat/anthropic', models: ['LongCat-Flash-Thinking-2601'], provider: 'anthropic' as const },
  { name: 'Custom', base: '', models: [], provider: 'anthropic' as const },
]

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve))
}

function isComplete(c: CodoConfig): boolean {
  return !!(c.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) && !!c.model && !!c.baseUrl
}

export async function ensureConfig(): Promise<CodoConfig> {
  let config = loadConfig()
  if (isComplete(config)) return config

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n🦞 Welcome to codo! No API configured yet.\n')
  console.log('Select your AI provider:\n')

  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i]
    console.log(`  ${i + 1}. ${p.name}${p.base ? ` (${p.base})` : ''}`)
  }

  let choice = 0
  while (choice < 1 || choice > PROVIDERS.length) {
    const input = await ask(rl, `\nEnter number (1-${PROVIDERS.length}): `)
    choice = parseInt(input)
    if (isNaN(choice)) { console.log('Please enter a number'); continue }
  }

  const sel = PROVIDERS[choice - 1]

  if (sel.name === 'Custom') {
    console.log('\n📝 Custom configuration:')
    config.baseUrl = await ask(rl, '  API Base URL (e.g. https://api.example.com): ')
    config.baseUrl = config.baseUrl.replace(/\/$/, '')
    config.model = await ask(rl, '  Model name (e.g. claude-sonnet-4-20250514): ')
    config.apiKey = await ask(rl, '  API Key: ')
    const prov = await ask(rl, '  Provider type (openai/anthropic, default anthropic): ')
    config.provider = (prov || 'anthropic') as any
  } else {
    config.baseUrl = sel.base
    config.provider = sel.provider

    if (sel.models.length === 1) {
      config.model = sel.models[0]
    } else {
      console.log('\nAvailable models:')
      sel.models.forEach((m, i) => console.log(`  ${i + 1}. ${m}`))
      let mi = 0
      while (mi < 1 || mi > sel.models.length) {
        const input = await ask(rl, `\nSelect model (1-${sel.models.length}): `)
        mi = parseInt(input)
      }
      config.model = sel.models[mi - 1]
    }

    if (sel.name === 'LongCat (free)') {
      config.apiKey = 'ak_1Cx02f4wH6dy8726EG2hv0B67yw3o'
    } else {
      config.apiKey = await ask(rl, `\n  ${sel.name} API Key: `)
    }
  }

  console.log('\n✅ Configuration saved!')
  console.log(`  Provider: ${config.provider}`)
  console.log(`  URL:      ${config.baseUrl}`)
  console.log(`  Model:    ${config.model}`)
  console.log(`  Key:      ${config.apiKey.slice(0, 8)}...\n`)

  saveConfig(config)
  rl.close()
  return config
}
