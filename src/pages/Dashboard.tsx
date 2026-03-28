import { Cpu, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAgents, useGpu } from '../hooks/useBackend'
import { AgentCard } from '../components/AgentCard'
import type { Agent } from '../types'

function isCreated(a: Agent) {
  return a.enabled || a.registered || a.persona.name !== 'Agent'
}

export function Dashboard() {
  const agents = useAgents()
  const gpu = useGpu()
  const created = agents.data?.filter(isCreated) ?? []
  const runningCount = created.filter((a: Agent) => a.running).length
  const enabledCount = created.filter((a: Agent) => a.enabled).length

  return (
    <div className="space-y-6">
      {/* Status bar — only show when agents exist */}
      {created.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-green-400' : 'bg-gray-600'}`} />
          <p className="text-sm font-medium text-gray-200">
            {runningCount} of {enabledCount} agents active
          </p>
        </div>
      )}

      {/* GPU info */}
      {gpu.data && gpu.data.vram_total_gb > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-medium text-gray-300">
              {(gpu.data.runners?.length ?? 0)} runner{(gpu.data.runners?.length ?? 0) !== 1 ? 's' : ''}
            </span>
          </div>
          {/* Total VRAM bar */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 bg-gray-800 rounded-full h-2">
              <div
                className="bg-brand-500 h-2 rounded-full transition-all"
                style={{ width: `${(gpu.data.vram_used_gb / gpu.data.vram_total_gb) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0">
              {gpu.data.vram_used_gb} / {gpu.data.vram_total_gb} GB VRAM
            </span>
          </div>
          {/* Per-runner breakdown */}
          {gpu.data.runners && <div className="space-y-1.5">
            {gpu.data.runners.map(r => (
              <div key={r.runner_id} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 truncate">{r.name}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-brand-500/60 h-1.5 rounded-full transition-all"
                    style={{ width: `${r.vram_total_gb > 0 ? (r.vram_used_gb / r.vram_total_gb) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {r.vram_used_gb}/{r.vram_total_gb} GB
                </span>
              </div>
            ))}
          </div>}
        </div>
      )}

      {/* Agent cards */}
      <div className="space-y-3">
        {agents.isLoading ? (
          <div className="text-center py-8 text-gray-600">Loading agents…</div>
        ) : created.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <p className="mb-4">No agents yet.</p>
            <Link
              to="/setup"
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create your first agent
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Agents</h2>
            {created.map((agent: Agent) => (
              <Link key={agent.slot} to={`/agent/${agent.slot}`} className="block">
                <AgentCard agent={agent} />
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
