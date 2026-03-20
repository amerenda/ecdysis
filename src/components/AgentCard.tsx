import { useState } from 'react'
import { Play, Square, RefreshCw, ChevronDown, ChevronUp, Zap, Loader2, Users } from 'lucide-react'
import { useStartAgent, useStopAgent, useTriggerHeartbeat, useInteractWithPeers, useAgentActivity } from '../hooks/useBackend'
import type { Agent, ActivityEntry } from '../types'

interface Props {
  agent: Agent
}

const ACTION_COLORS: Record<string, string> = {
  posted: 'text-brand-400',
  commented: 'text-blue-400',
  replied: 'text-cyan-400',
  browsed: 'text-gray-400',
  heartbeat: 'text-green-400',
  error: 'text-red-400',
  dm_request_pending: 'text-amber-400',
  dm_approved: 'text-green-400',
  manual_post: 'text-purple-400',
  peer_interact: 'text-violet-400',
  thread_reply: 'text-sky-400',
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const color = ACTION_COLORS[entry.action] ?? 'text-gray-400'
  const ts = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-gray-800 last:border-0">
      <span className="text-gray-600 flex-shrink-0">{ts}</span>
      <span className={`${color} flex-shrink-0 w-24`}>{entry.action}</span>
      <span className="text-gray-400 truncate">{entry.detail}</span>
    </div>
  )
}

export function AgentCard({ agent }: Props) {
  const [expanded, setExpanded] = useState(false)
  const start = useStartAgent()
  const stop = useStopAgent()
  const heartbeat = useTriggerHeartbeat()
  const interactPeers = useInteractWithPeers()
  const activity = useAgentActivity(agent.slot, expanded)

  const statusColor = agent.running ? 'bg-green-400' : 'bg-gray-600'
  const lastBeat = agent.state.last_heartbeat
    ? new Date(agent.state.last_heartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Never'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-brand-900 flex items-center justify-center text-brand-300 font-bold">
            {agent.slot}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${statusColor}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-100 truncate">{agent.persona.name}</h3>
            {!agent.registered && (
              <span className="text-xs bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded">
                Not registered
              </span>
            )}
            {agent.registered && !agent.claimed && (
              <span className="text-xs bg-orange-900 text-orange-300 px-1.5 py-0.5 rounded">
                Unclaimed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">{agent.model}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!agent.running ? (
            <button
              onClick={() => start.mutate(agent.slot)}
              disabled={!agent.registered || start.isPending}
              title={!agent.registered ? 'Register first' : 'Start agent'}
              className="p-1.5 rounded-lg bg-green-900/50 hover:bg-green-800/50 disabled:opacity-30 text-green-400 transition-colors"
            >
              {start.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
            </button>
          ) : (
            <>
              <button
                onClick={() => heartbeat.mutate(agent.slot)}
                disabled={heartbeat.isPending}
                title="Trigger heartbeat now"
                className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
              >
                {heartbeat.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Zap className="w-4 h-4" />}
              </button>
              <button
                onClick={() => interactPeers.mutate(agent.slot)}
                disabled={interactPeers.isPending}
                title="Interact with other running agents' posts"
                className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
              >
                {interactPeers.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Users className="w-4 h-4" />}
              </button>
              <button
                onClick={() => stop.mutate(agent.slot)}
                disabled={stop.isPending}
                title="Stop agent"
                className="p-1.5 rounded-lg bg-red-900/50 hover:bg-red-800/50 text-red-400 transition-colors"
              >
                {stop.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Square className="w-4 h-4" />}
              </button>
            </>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-gray-500">Karma</p>
          <p className="text-sm font-medium text-gray-200">{agent.state.karma}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last beat</p>
          <p className="text-sm font-medium text-gray-200">{lastBeat}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">DM requests</p>
          <p className={`text-sm font-medium ${agent.state.pending_dm_requests.length > 0 ? 'text-amber-400' : 'text-gray-200'}`}>
            {agent.state.pending_dm_requests.length}
          </p>
        </div>
      </div>

      {/* Expanded activity log */}
      {expanded && (
        <div className="border-t border-gray-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Activity</p>
            {activity.isFetching && <RefreshCw className="w-3 h-3 text-gray-600 animate-spin" />}
          </div>
          {activity.data && activity.data.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              {activity.data.map((e, i) => <ActivityRow key={i} entry={e} />)}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No activity yet</p>
          )}
        </div>
      )}
    </div>
  )
}
