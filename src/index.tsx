// ─── Entry Point ──────────────────────────────────────────────────────────
import React from 'react'
import { render } from 'ink'
import { App } from './ui/App.js'
import { loadConfig, saveConfig, hasApiKey, detectProvider } from './config/index.js'
import { runQuery } from './query/index.js'

const args = process.argv.slice(2)

if (args.includes('--help')) {
  console.log(`🦞 codo - AI coding assistant (CC architecture, model-agnostic)

Usage: codo [prompt] | codo --print [prompt] | codo --config | codo --help
Options: -m/--model MODEL | --provider openai|anthropic|openrouter
Env: OPENROUTER_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY`)
  process.exit(0)
}

if (args.includes('--config')) {
  const c = loadConfig()
  console.log(`🦞 codo config\n  Key: ${c.apiKey ? c.apiKey.slice(0, 8) + '...' : '(not set)'}\n  URL: ${c.baseUrl}\n  Model: ${c.model}\n  Provider: ${detectProvider(c)}\n  Available: ${hasApiKey(c) ? '✅' : '❌'}`)
  process.exit(0)
}

const mi = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('--model')
if (mi !== -1 && args[mi + 1]) { const c = loadConfig(); c.model = args[mi + 1]; saveConfig(c) }
const prompt = args.filter(a => !a.startsWith('-') && a !== args[mi + 1]).join(' ') || undefined

if (process.stdin.isTTY && process.stdout.isTTY && !args.includes('--print')) {
  render(React.createElement(App, { initialPrompt: prompt }))
} else {
  const config = loadConfig()
  if (!prompt) { console.log('🦞 codo (non-interactive). Use --help.'); process.exit(0) }
  console.log(`🦞 codo [${config.model}]\n`)
  await runQuery(prompt, config, [], {
    onText: t => console.log(`\n${t}`),
    onToolStart: (n, a) => console.log(`\n🔧 ${n}(${a.length > 40 ? a.slice(0, 40) + '...' : a})`),
    onToolResult: (_, r) => console.log(`   ${r.content.split('\n')[0].slice(0, 60)}`),
    onTurn: t => { if (t > 1) process.stdout.write(`\r⏳ turn ${t}`) },
    onError: e => console.error(`❌ ${e}`),
  })
}
