// ─── Entry Point ──────────────────────────────────────────────────────────
import React from 'react'
import { render } from 'ink'
import { App } from './ui/App.js'
import { loadConfig, saveConfig, hasApiKey, detectProvider, loadSession } from './config/index.js'
import { runQuery } from './query/index.js'
import { processCommand } from './commands/index.js'
import { getContextStats, shouldCompact } from './memory/index.js'
import { ensureConfig } from './setup/index.js'

const args = process.argv.slice(2)

if (args.includes('--help')) {
  console.log(`🦞 codo - AI coding assistant (CC architecture, model-agnostic)

Usage: codo [prompt] | codo --print [prompt] | codo --config | codo --setup | codo --help
Options: -m/--model MODEL | --provider openai|anthropic|openrouter
Slash commands: /help /clear /history /quit
Env: OPENROUTER_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY`)
  process.exit(0)
}

// --config: show current config
if (args.includes('--config')) {
  const c = loadConfig()
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
  console.log(`🦞 codo config\n  Key: ${c.apiKey ? c.apiKey.slice(0, 8) + '...' : '(not set)'}\n  URL: ${c.baseUrl}\n  Model: ${c.model}\n  Provider: ${detectProvider(c)}\n  Available: ${hasApiKey(c) ? '✅' : '❌'}`)
  process.exit(0)
}

// --setup: force re-run interactive setup
if (args.includes('--setup')) {
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { unlinkSync, existsSync } = await import('fs')
  const cfg = join(homedir(), '.codo', 'config.json')
  if (existsSync(cfg)) unlinkSync(cfg)
  console.log('🗑️ Config cleared. Re-running setup...\n')
  const config = await ensureConfig()
  console.log('Done! Run `codo` to start using it.')
  process.exit(0)
}

// First-run: check config, interactive setup if incomplete
const config = await ensureConfig()

const mi = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('--model')
if (mi !== -1 && args[mi + 1]) { config.model = args[mi + 1]; saveConfig(config) }
const prompt = args.filter(a => !a.startsWith('-') && a !== args[mi + 1]).join(' ') || undefined

if (process.stdin.isTTY && process.stdout.isTTY && !args.includes('--print')) {
  render(React.createElement(App, { initialPrompt: prompt }))
} else {
  if (!prompt) { console.log('🦞 codo (non-interactive). Use --help.'); process.exit(0) }

  const cmdResult = processCommand(prompt)
  if (cmdResult) {
    console.log(cmdResult.content)
    process.exit(cmdResult.type === 'error' ? 1 : 0)
  }

  console.log(`🦞 codo [${config.model}]\n`)

  const msgs = loadSession()
  if (msgs.length > 0) {
    console.log(`  ${getContextStats(msgs)}`)
    if (shouldCompact(msgs)) {
      console.log('  ⚠️ Context is large. Consider /compact')
    }
  }

  await runQuery(prompt, config, [...msgs], {
    onText: t => console.log(`\n${t}`),
    onToolStart: (n, a) => console.log(`\n🔧 ${n}(${a.length > 40 ? a.slice(0, 40) + '...' : a})`),
    onToolResult: (_, r) => console.log(`   ${r.content.split('\n')[0].slice(0, 60)}`),
    onTurn: t => { if (t > 1) process.stdout.write(`\r⏳ turn ${t}`) },
    onError: e => console.error(`❌ ${e}`),
  })
}
