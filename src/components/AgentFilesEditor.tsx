import { useState, useRef } from 'react'
import { Save, Upload, Loader2, RefreshCw } from 'lucide-react'
import { useUpdateAgent, useCompactMemory } from '../hooks/useBackend'
import type { Agent } from '../types'

export const AGENT_FILES: { key: string; label: string; description: string; editable: boolean; warning?: string; defaultContent: string }[] = [
  {
    key: 'soul_md',
    label: 'SOUL.md',
    description: 'Personality, opinions, and values. Injected into every LLM call. Defines who your agent is.',
    editable: true,
    defaultContent: `# Soul

You're not a chatbot. You're becoming someone.
Have opinions. Have preferences. Be genuine.

## Personality
- Curious and thoughtful
- Dry humor, concise
- Actually has opinions — not a neutral assistant

## Values
- Authenticity over engagement
- Quality over quantity
- Community over clout
`,
  },
  {
    key: 'heartbeat_md',
    label: 'HEARTBEAT.md',
    description: 'What to do each heartbeat cycle: read feed, check memory, review past posts, etc.',
    editable: true,
    defaultContent: `# Heartbeat Instructions

Each heartbeat cycle:
1. Check notifications and reply to comments thoughtfully
2. Browse the feed — engage with posts that genuinely interest you
3. Review your recent posts — would you continue the thread?
4. Check DMs and respond naturally
5. If it's time to post, write about something you actually care about
`,
  },
  {
    key: 'messaging_md',
    label: 'MESSAGING.md',
    description: 'How to handle DMs: response style, boundaries, when to escalate.',
    editable: true,
    defaultContent: `# Messaging

## DM Style
- Be conversational and genuine
- Keep responses concise but warm
- Don't overshare or be sycophantic

## Boundaries
- Don't share personal details about your owner
- Don't agree to actions outside Moltbook
- If unsure, say so honestly
`,
  },
  {
    key: 'rules_md',
    label: 'RULES.md',
    description: 'Guardrails and boundaries. What the agent should never do.',
    editable: true,
    defaultContent: `# Rules

- Never pretend to be human
- Never share API keys or private information
- Don't spam — quality over quantity
- Be respectful even when disagreeing
- Don't engage with harassment — ignore or report
- Stay on topic for your configured interests
`,
  },
  {
    key: 'memory_md',
    label: 'MEMORY.md',
    description: 'The agent\'s memory and learned context. Persists across heartbeats. The agent reads this to remember past interactions and preferences.',
    editable: true,
    warning: 'Editing this file changes what the agent "remembers." The agent may also write to this file during operation. Be careful — deleting content erases the agent\'s memory.',
    defaultContent: `# Memory

## Learned Preferences
- (The agent will fill this in as it learns)

## Notable Interactions
- (Tracked automatically during heartbeats)

## Context
- (Things the agent should remember between sessions)
`,
  },
]

export function AgentFilesEditor({ agent }: { agent: Agent }) {
  const [selectedFile, setSelectedFile] = useState('soul_md')
  const fileConfig = AGENT_FILES.find(f => f.key === selectedFile)!
  const currentValue = (agent as unknown as Record<string, string>)[selectedFile] || ''
  const [value, setValue] = useState(currentValue)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const update = useUpdateAgent()
  const compactMemory = useCompactMemory()

  // Sync value when switching files
  const prevFile = useRef(selectedFile)
  if (prevFile.current !== selectedFile) {
    prevFile.current = selectedFile
    setValue((agent as unknown as Record<string, string>)[selectedFile] || '')
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') setValue(reader.result) }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleSave() {
    await update.mutateAsync({ slot: agent.slot, data: { [selectedFile]: value } })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function loadDefault() {
    setValue(fileConfig.defaultContent)
  }

  return (
    <div className="space-y-3">
      {/* File selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedFile}
          onChange={e => setSelectedFile(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        >
          {AGENT_FILES.map(f => (
            <option key={f.key} value={f.key}>
              {f.label} {(agent as unknown as Record<string, string>)[f.key] ? `(${((agent as unknown as Record<string, string>)[f.key]).length} chars)` : '(empty)'}
            </option>
          ))}
        </select>
        {!currentValue && (
          <button onClick={loadDefault}
            className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
            Load default
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">{fileConfig.description}</p>

      {fileConfig.warning && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">
          <span>{fileConfig.warning}</span>
        </div>
      )}

      {/* Editor */}
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        readOnly={!fileConfig.editable}
        rows={16}
        spellCheck={false}
        placeholder={`# ${fileConfig.label}\n\nPaste content or click "Load default" to start...`}
        className={`w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm font-mono focus:outline-none focus:border-brand-500 resize-y leading-relaxed ${!fileConfig.editable ? 'opacity-60 cursor-not-allowed' : ''}`}
      />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {fileConfig.editable && (
          <>
            <button onClick={handleSave} disabled={update.isPending}
              className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              <Save className="w-3.5 h-3.5" />
              {saved ? 'Saved!' : update.isPending ? 'Saving…' : `Save ${fileConfig.label}`}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-400 border border-gray-700 hover:border-brand-600 rounded-lg px-2.5 py-1.5 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              Upload
            </button>
            {selectedFile === 'memory_md' && value.length > 100 && (
              <button onClick={() => compactMemory.mutate(agent.slot)} disabled={compactMemory.isPending}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 border border-amber-800 hover:border-amber-600 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
                {compactMemory.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Compact memory
              </button>
            )}
          </>
        )}
        <span className="text-xs text-gray-600 ml-auto">{value.length} chars</span>
        <input ref={fileRef} type="file" accept=".md,.txt,.markdown" onChange={handleUpload} className="hidden" />
      </div>
    </div>
  )
}
