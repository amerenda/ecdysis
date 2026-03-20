import { Cpu } from 'lucide-react'
import { useAgents, useGpu } from '../hooks/useBackend'
import { AgentCard } from '../components/AgentCard'

export function Dashboard() {
  const agents = useAgents()
  const gpu = useGpu()

  const runningCount = agents.data?.filter(a => a.running).length ?? 0
  const enabledCount = agents.data?.filter(a => a.enabled).length ?? 0

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-green-400' : 'bg-gray-600'}`} />
        <p className="text-sm font-medium text-gray-200">
          {runningCount} of {enabledCount} agents active
        </p>
      </div>

      {/* GPU info */}
      {gpu.data && gpu.data.vram_total_gb > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-medium text-gray-300">{gpu.data.name}</span>
          </div>
          <div className="flex items-center gap-3">
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
        </div>
      )}

      {/* Agent cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Agents</h2>
        {agents.isLoading ? (
          <div className="text-center py-8 text-gray-600">Loading agents…</div>
        ) : agents.data?.length === 0 ? (
          <div className="text-center py-8 text-gray-600">No agents configured yet. Go to Setup.</div>
        ) : (
          agents.data?.map(agent => (
            <AgentCard key={agent.slot} agent={agent} />
          ))
        )}
      </div>
    </div>
  )
}
