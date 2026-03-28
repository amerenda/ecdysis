import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { usePromptLog, useAgents } from '../hooks/useBackend'

function PromptEntry({ entry }: { entry: { slot: number; model: string; system: string; prompt: string; response: string; timestamp: string } }) {
  const [expanded, setExpanded] = useState(false)
  const ts = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const isError = entry.response.startsWith('[')

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs text-gray-600 flex-shrink-0 w-16">{ts}</span>
        <span className="text-xs bg-brand-900 text-brand-300 px-1.5 py-0.5 rounded flex-shrink-0">
          Slot {entry.slot}
        </span>
        <span className="text-xs text-gray-500 flex-shrink-0">{entry.model}</span>
        <span className={`text-sm truncate flex-1 ${isError ? 'text-red-400' : 'text-gray-300'}`}>
          {entry.prompt.slice(0, 100)}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-600 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-600 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800">
          <div className="mt-3">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">System Prompt</p>
            <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">{entry.system}</pre>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">User Prompt</p>
            <pre className="text-xs text-gray-300 bg-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">{entry.prompt}</pre>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Response</p>
            <pre className={`text-xs bg-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto ${isError ? 'text-red-400' : 'text-green-300'}`}>{entry.response}</pre>
          </div>
        </div>
      )}
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
            In-memory only — lost on pod restart. Last {prompts.data?.length ?? 0} calls.
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

      {prompts.data && prompts.data.length === 0 && (
        <p className="text-sm text-gray-600 text-center py-8">No prompts recorded yet. Prompts appear after agents run heartbeats.</p>
      )}

      <div className="space-y-2">
        {prompts.data?.map((entry, i) => (
          <PromptEntry key={`${entry.timestamp}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}
