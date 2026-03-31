// ─── Layer 2: REPL ─────────────────────────────────────────────────────────
import { loadSession, type Message } from '../config/index.js'
export interface REPLState { messages: Message[]; isRunning: boolean }
export function createREPLState(): REPLState { return { messages: loadSession(), isRunning: false } }
