import { useState } from 'react'
import { FileText, RefreshCw, Filter } from 'lucide-react'
import { useSystemLogs, useAgents } from '../hooks/useBackend'
import type { SystemLog } from '../hooks/useBackend'

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-red-400 bg-red-900/30',
  WARNING: 'text-amber-400 bg-amber-900/30',
  INFO: 'text-blue-400 bg-blue-900/30',
  DEBUG: 'text-gray-500 bg-gray-800',
}

const SOURCE_COLORS: Record<string, string> = {
  backend: 'text-purple-400 bg-purple-900/30',
  frontend: 'text-cyan-400 bg-cyan-900/30',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Logs() {
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined)
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined)
  const [slotFilter, setSlotFilter] = useState<number | undefined>(undefined)
  const logs = useSystemLogs(sourceFilter, levelFilter, slotFilter)
  const agents = useAgents()
  const logList = logs.data ?? []

  // Group logs by date
  const grouped: Record<string, SystemLog[]> = {}
  for (const log of logList) {
    const date = formatDate(log.created_at)
    ;(grouped[date] ??= []).push(log)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-400" />
          <h1 className="text-base font-semibold text-gray-200">System Logs</h1>
          <span className="text-xs text-gray-600">{logList.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          {logs.isFetching && <RefreshCw className="w-3 h-3 text-gray-600 animate-spin" />}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-gray-600" />
          <span className="text-xs text-gray-600">Source:</span>
        </div>
        {['all', 'backend', 'frontend'].map(s => (
          <button
            key={s}
            onClick={() => setSourceFilter(s === 'all' ? undefined : s)}
            className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              (s === 'all' && !sourceFilter) || sourceFilter === s
                ? 'bg-brand-900/50 text-brand-300 border border-brand-800'
                : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
            }`}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        <div className="w-px bg-gray-800 mx-1" />

        <span className="text-xs text-gray-600">Level:</span>
        {['all', 'ERROR', 'WARNING', 'INFO'].map(l => (
          <button
            key={l}
            onClick={() => setLevelFilter(l === 'all' ? undefined : l)}
            className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              (l === 'all' && !levelFilter) || levelFilter === l
                ? 'bg-brand-900/50 text-brand-300 border border-brand-800'
                : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
            }`}
          >
            {l === 'all' ? 'All' : l}
          </button>
        ))}

        <div className="w-px bg-gray-800 mx-1" />

        <span className="text-xs text-gray-600">Agent:</span>
        <button
          onClick={() => setSlotFilter(undefined)}
          className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
            slotFilter === undefined
              ? 'bg-brand-900/50 text-brand-300 border border-brand-800'
              : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
          }`}
        >
          All
        </button>
        {(agents.data ?? []).filter(a => a.registered).map(a => (
          <button
            key={a.slot}
            onClick={() => setSlotFilter(a.slot)}
            className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              slotFilter === a.slot
                ? 'bg-brand-900/50 text-brand-300 border border-brand-800'
                : 'bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700'
            }`}
          >
            {a.persona.name}
          </button>
        ))}
      </div>

      {/* Log entries */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {logs.isLoading ? (
          <div className="py-8 text-center text-gray-600 text-sm">Loading logs...</div>
        ) : logList.length === 0 ? (
          <div className="py-8 text-center text-gray-600 text-sm">No logs match filters</div>
        ) : (
          <div className="divide-y divide-gray-800/50 max-h-[70vh] overflow-y-auto">
            {Object.entries(grouped).map(([date, entries]) => (
              <div key={date}>
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur px-4 py-1.5 border-b border-gray-800">
                  <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">{date}</span>
                </div>
                {entries.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-2 hover:bg-gray-800/30 transition-colors">
                    <span className="text-[10px] text-gray-600 tabular-nums pt-0.5 whitespace-nowrap min-w-[70px]">
                      {formatTime(log.created_at)}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium min-w-[55px] text-center ${
                      LEVEL_COLORS[log.level] || 'text-gray-500 bg-gray-800'
                    }`}>
                      {log.level}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded min-w-[60px] text-center ${
                      SOURCE_COLORS[log.source] || 'text-gray-500 bg-gray-800'
                    }`}>
                      {log.source}
                    </span>
                    <span className="text-xs text-gray-300 flex-1 break-all font-mono leading-relaxed">
                      {log.message}
                    </span>
                    {log.pod_name && (
                      <span className="text-[10px] text-gray-700 whitespace-nowrap">{log.pod_name.slice(-8)}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
