import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { usePromptLog, useAgents } from '../hooks/useBackend'

function classifyPrompt(prompt: string, system: string): { label: string; color: string } {
  const p = prompt.toLowerCase()
  if (p.includes('comment? yes or no')) return { label: 'Comment decision', color: 'text-blue-400' }
  if (p.includes('write one thoughtful comment') || p.includes('write a thoughtful reply'))
    return { label: 'Comment', color: 'text-blue-300' }
  if (p.includes('replied to your post') || p.includes('write a thoughtful reply'))
    return { label: 'Reply', color: 'text-cyan-300' }
  if (p.includes('title:') && p.includes('body:')) return { label: 'Post', color: 'text-brand-300' }
  if (p.includes('write a genuine post') || p.includes('choose one topic'))
    return { label: 'Post', color: 'text-brand-300' }
  if (p.includes('follow-up thought') || p.includes('continue this thread'))
    return { label: 'Thread reply', color: 'text-sky-300' }
  if (p.includes('pick the one most interesting')) return { label: 'Pick comment', color: 'text-violet-300' }
  if (p.includes('what you should remember')) return { label: 'Memory update', color: 'text-indigo-300' }
  if (p.includes('solve this math')) return { label: 'Challenge', color: 'text-amber-300' }
  if (p.includes('rewrite it shorter')) return { label: 'Shorten post', color: 'text-brand-300' }
  if (p.includes('list only the numbers')) return { label: 'Browse decision', color: 'text-gray-300' }
  if (system.includes('concise note-taker')) return { label: 'Memory update', color: 'text-indigo-300' }
  if (system.includes('math solver')) return { label: 'Challenge', color: 'text-amber-300' }
  return { label: 'LLM call', color: 'text-gray-400' }
}

function PromptEntry({ entry }: { entry: { slot: number; model: string; system: string; prompt: string; response: string; timestamp: string } }) {
  const [showSystem, setShowSystem] = useState(false)
  const ts = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const isError = entry.response.startsWith('[')
  const { label, color } = classifyPrompt(entry.prompt, entry.system)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-xs text-gray-600 flex-shrink-0 w-16">{ts}</span>
        <span className="text-xs bg-brand-900 text-brand-300 px-1.5 py-0.5 rounded flex-shrink-0">
          Slot {entry.slot}
        </span>
        <span className={`text-xs font-medium ${color} flex-shrink-0`}>{label}</span>
        <span className="text-xs text-gray-500 flex-shrink-0">{entry.model}</span>
      </div>

      {/* Prompt */}
      <div className="px-4 pb-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label === 'Post' ? 'Post Prompt' : label === 'Comment' || label === 'Reply' ? 'Comment Context' : 'Prompt'}</p>
        <pre className="text-xs text-gray-300 bg-gray-800 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{entry.prompt}</pre>
      </div>

      {/* Response */}
      <div className="px-4 pb-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Response</p>
        <pre className={`text-xs bg-gray-800 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto ${isError ? 'text-red-400' : 'text-green-300'}`}>{entry.response}</pre>
      </div>

      {/* System prompt — collapsed at bottom */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setShowSystem(s => !s)}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          {showSystem ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          System prompt ({entry.system.length} chars)
        </button>
        {showSystem && (
          <pre className="text-xs text-gray-500 bg-gray-800 rounded-lg p-3 whitespace-pre-wrap max-h-60 overflow-y-auto mt-1">{entry.system}</pre>
        )}
      </div>
    </div>
  )
}

export function Prompts() {
  const [slotFilter, setSlotFilter] = useState<number | undefined>(undefined)
  const agents = useAgents()
  const prompts = usePromptLog(slotFilter)

  const activeAgents = agents.data?.filter(a => a.registered) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Recent Prompts</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            In-memory only — lost on pod restart.
            {prompts.data && <> {prompts.data.entries.length} calls from <span className="text-gray-400">{prompts.data.pod}</span></>}
          </p>
        </div>
        <select
          value={slotFilter ?? ''}
          onChange={e => setSlotFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-brand-500"
        >
          <option value="">All agents</option>
          {activeAgents.map(a => (
            <option key={a.slot} value={a.slot}>{a.persona.name} (slot {a.slot})</option>
          ))}
        </select>
      </div>

      {prompts.isLoading && (
        <p className="text-sm text-gray-600 text-center py-8">Loading...</p>
      )}

      {prompts.data && prompts.data.entries.length === 0 && (
        <p className="text-sm text-gray-600 text-center py-8">No prompts recorded yet. Prompts appear after agents run heartbeats.</p>
      )}

      <div className="space-y-2">
        {prompts.data?.entries.map((entry, i) => (
          <PromptEntry key={`${entry.timestamp}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}
