import { useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Square, Zap, Users, Loader2, Settings, RefreshCw,
  FileText, Key, Eye, EyeOff, Save, HelpCircle, ExternalLink, Filter, Download,
} from 'lucide-react'
import {
  useAgents, useAgentActivity, useAgentPosts, useModels,
  useStartAgent, useStopAgent,
  useTriggerHeartbeat, useToggleDryRunMode, useInteractWithPeers,
  useUpdateAgent, useClaimStatus,
} from '../hooks/useBackend'
import { AgentFilesEditor } from '../components/AgentFilesEditor'
import type { Agent, ActivityEntry } from '../types'

// ── Tooltip ──────────────────────────────────────────────────────────────────

function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="text-gray-600 hover:text-gray-400 transition-colors ml-1"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={e => { e.preventDefault(); setOpen(o => !o) }}
        aria-label="Help"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-60 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-gray-300 shadow-xl pointer-events-none block">
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
          {text}
        </span>
      )}
    </span>
  )
}

// ── Activity colors ──────────────────────────────────────────────────────────

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
  memory: 'text-indigo-400',
  skipped_reply: 'text-gray-600',
  skipped_comment: 'text-gray-600',
  skipped_thread: 'text-gray-600',
  skipped_post: 'text-gray-600',
  skipped_peer_comment: 'text-gray-600',
  dry_run: 'text-purple-400',
  dry_run_post: 'text-purple-400',
  dry_run_comment: 'text-purple-400',
  dry_run_upvote: 'text-purple-400',
}

const SKIPPED_ACTIONS = new Set(['skipped_reply', 'skipped_comment', 'skipped_thread', 'skipped_post', 'skipped_peer_comment'])
const DEBUG_ACTIONS = new Set(['debug_prompt'])

// ── API Key inline editor ────────────────────────────────────────────────────

function ApiKeyInline({ agent }: { agent: Agent }) {
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const update = useUpdateAgent()

  async function handleSave() {
    if (!key.trim()) return
    try {
      await update.mutateAsync({ slot: agent.slot, data: { api_key: key.trim() } })
      setResult('Saved')
      setEditing(false)
      setKey('')
      setTimeout(() => setResult(null), 3000)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  const preview = agent.api_key
    ? agent.api_key.slice(0, 12) + '···' + agent.api_key.slice(-4)
    : 'not set'

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-gray-400">{preview}</span>
        <button onClick={() => setEditing(true)} className="text-xs text-brand-400 hover:text-brand-300">
          Change
        </button>
        {result && <span className="text-xs text-green-400">{result}</span>}
      </div>
    )
  }

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="moltbook_sk_..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-8 text-gray-100 text-xs font-mono focus:outline-none focus:border-brand-500"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <button onClick={handleSave} disabled={update.isPending || !key.trim()}
        className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs px-2.5 py-1.5 rounded-lg">
        Save
      </button>
      <button onClick={() => { setEditing(false); setKey('') }}
        className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
    </div>
  )
}

// ── Agent files editor (soul.md, heartbeat.md, etc.) ─────────────────────────

// ── Inline config editor ─────────────────────────────────────────────────────

function ConfigEditor({ agent, models }: { agent: Agent; models: { name: string; vram_estimate_gb: number; fits?: boolean }[] }) {
  const update = useUpdateAgent()
  const [form, setForm] = useState({
    model: agent.model,
    name: agent.persona.name,
    description: agent.persona.description,
    tone: agent.persona.tone,
    topics: agent.persona.topics.join(', '),
    post_interval_minutes: agent.schedule.post_interval_minutes,
    heartbeat_interval_minutes: agent.schedule.heartbeat_interval_minutes,
    heartbeat_jitter_pct: agent.schedule.heartbeat_jitter_pct,
    active_hours_start: agent.schedule.active_hours_start,
    active_hours_end: agent.schedule.active_hours_end,
    max_post_length: agent.behavior.max_post_length,
    auto_reply: agent.behavior.auto_reply,
    auto_like: agent.behavior.auto_like,
    reply_to_own_threads: agent.behavior.reply_to_own_threads,
    max_replies_per_heartbeat: agent.behavior.max_replies_per_heartbeat,
    max_comments_per_post: agent.behavior.max_comments_per_post,
    post_jitter_pct: agent.behavior.post_jitter_pct,
    karma_throttle: agent.behavior.karma_throttle,
    karma_throttle_threshold: agent.behavior.karma_throttle_threshold,
    karma_throttle_multiplier: agent.behavior.karma_throttle_multiplier,
    target_submolts: agent.behavior.target_submolts.join(', '),
    exclude_submolts: agent.behavior.exclude_submolts.join(', '),
    auto_dm_approve: agent.behavior.auto_dm_approve,
    send_peer_likes: agent.behavior.send_peer_likes,
    send_peer_comments: agent.behavior.send_peer_comments,
    receive_peer_likes: agent.behavior.receive_peer_likes,
    receive_peer_comments: agent.behavior.receive_peer_comments,
    log_skipped: agent.behavior.log_skipped,
  })
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    await update.mutateAsync({
      slot: agent.slot,
      data: {
        model: form.model,
        persona: {
          name: form.name,
          description: form.description,
          tone: form.tone,
          topics: form.topics.split(',').map(t => t.trim()).filter(Boolean),
        },
        schedule: {
          post_interval_minutes: form.post_interval_minutes,
          heartbeat_interval_minutes: form.heartbeat_interval_minutes,
          heartbeat_jitter_pct: form.heartbeat_jitter_pct,
          active_hours_start: form.active_hours_start,
          active_hours_end: form.active_hours_end,
        },
        behavior: {
          max_post_length: form.max_post_length,
          auto_reply: form.auto_reply,
          auto_like: form.auto_like,
          reply_to_own_threads: form.reply_to_own_threads,
          max_replies_per_heartbeat: form.max_replies_per_heartbeat,
          max_comments_per_post: form.max_comments_per_post,
          post_jitter_pct: form.post_jitter_pct,
          karma_throttle: form.karma_throttle,
          karma_throttle_threshold: form.karma_throttle_threshold,
          karma_throttle_multiplier: form.karma_throttle_multiplier,
          target_submolts: form.target_submolts.split(',').map((s: string) => s.trim()).filter(Boolean),
          exclude_submolts: form.exclude_submolts.split(',').map((s: string) => s.trim()).filter(Boolean),
          auto_dm_approve: form.auto_dm_approve,
          send_peer_likes: form.send_peer_likes,
          send_peer_comments: form.send_peer_comments,
          receive_peer_likes: form.receive_peer_likes,
          receive_peer_comments: form.receive_peer_comments,
          log_skipped: form.log_skipped,
        },
      },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-brand-500"

  return (
    <div className="space-y-4">
      {/* Model */}
      <div>
        <label className="flex items-center text-xs text-gray-500 mb-1">Model</label>
        <select value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputCls}>
          {models.map(m => (
            <option key={m.name} value={m.name}>{m.name} ({m.vram_estimate_gb} GB)</option>
          ))}
          {!models.some(m => m.name === form.model) && (
            <option value={form.model}>{form.model}</option>
          )}
        </select>
        {!models.some(m => m.name === form.model) && (
          <p className="text-xs text-red-400 mt-1">Model not found — download it from the library or change the model.</p>
        )}
      </div>

      {/* Persona */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Username</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Tone <Tip text="Legacy fallback — only used if SOUL.md is empty. Leave blank and use SOUL.md instead for full personality control." /></label>
          <input value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))} placeholder="Leave blank — use SOUL.md instead" className={inputCls} />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Bio</label>
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className={inputCls + ' resize-none'} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Topics</label>
        <input value={form.topics} onChange={e => setForm(f => ({ ...f, topics: e.target.value }))} placeholder="technology, coffee" className={inputCls} />
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Post every (min) <Tip text="Minimum time between new posts. The agent may still reply, like, and comment between posts." /></label>
          <input type="number" min={30} value={form.post_interval_minutes} onChange={e => setForm(f => ({ ...f, post_interval_minutes: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Heartbeat (min) <Tip text="How often the agent wakes up to read feed, reply to comments, like posts, handle DMs, and interact with peers. Does not create new posts — that's controlled by 'Post every'." /></label>
          <input type="number" min={5} max={120} value={form.heartbeat_interval_minutes} onChange={e => setForm(f => ({ ...f, heartbeat_interval_minutes: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Active from (h)</label>
          <input type="number" min={0} max={23} value={form.active_hours_start} onChange={e => setForm(f => ({ ...f, active_hours_start: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Active until (h)</label>
          <input type="number" min={1} max={24} value={form.active_hours_end} onChange={e => setForm(f => ({ ...f, active_hours_end: +e.target.value }))} className={inputCls} />
        </div>
      </div>

      {/* Jitter */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Post jitter ({form.post_jitter_pct}%) <Tip text="Randomizes the interval between new posts. 20% on a 120-min interval = 96-144 min." /></label>
          <input type="range" min={0} max={50} step={5} value={form.post_jitter_pct}
            onChange={e => setForm(f => ({ ...f, post_jitter_pct: +e.target.value }))} className="w-full accent-brand-500" />
        </div>
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Heartbeat jitter ({form.heartbeat_jitter_pct}%) <Tip text="Randomizes time between heartbeats (reading, liking, commenting). 20% on 30 min = 24-36 min." /></label>
          <input type="range" min={0} max={50} step={5} value={form.heartbeat_jitter_pct}
            onChange={e => setForm(f => ({ ...f, heartbeat_jitter_pct: +e.target.value }))} className="w-full accent-brand-500" />
        </div>
      </div>

      {/* Reply limits */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Replies per heartbeat <Tip text="Maximum number of comment replies the agent will make in a single heartbeat cycle. The agent picks the most interesting comments to reply to." /></label>
          <input type="number" min={0} max={10} value={form.max_replies_per_heartbeat} onChange={e => setForm(f => ({ ...f, max_replies_per_heartbeat: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Max comments per post <Tip text="Maximum number of the agent's own comments on a single post. Once reached, the agent stops replying to that post." /></label>
          <input type="number" min={1} max={20} value={form.max_comments_per_post} onChange={e => setForm(f => ({ ...f, max_comments_per_post: +e.target.value }))} className={inputCls} />
        </div>
      </div>

      {/* Submolt targeting */}
      <div>
        <label className="flex items-center text-xs text-gray-500 mb-1">Target submolts <Tip text="Preferred communities to post in. If empty, the agent discovers submolts automatically from Moltbook." /></label>
        <input value={form.target_submolts} onChange={e => setForm(f => ({ ...f, target_submolts: e.target.value }))} placeholder="general, philosophy (empty = auto-discover)" className={inputCls} />
      </div>
      <div>
        <label className="flex items-center text-xs text-gray-500 mb-1">Exclude submolts <Tip text="Communities to never post in. Only applies when auto-discovering (target submolts is empty)." /></label>
        <input value={form.exclude_submolts} onChange={e => setForm(f => ({ ...f, exclude_submolts: e.target.value }))} placeholder="crypto, trading" className={inputCls} />
      </div>

      {/* Behavior toggles */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {([
          ['auto_reply', 'Auto-reply'],
          ['auto_like', 'Auto-like'],
          ['reply_to_own_threads', 'Extend threads'],
          ['auto_dm_approve', 'Auto-approve DMs'],
          ['karma_throttle', 'Karma throttle'],
          ['send_peer_likes', 'Send peer likes'],
          ['send_peer_comments', 'Send peer comments'],
          ['receive_peer_likes', 'Track peer likes'],
          ['receive_peer_comments', 'Reply to peer comments'],
          ['log_skipped', 'Log skipped actions'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={(form as any)[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
              className="accent-brand-500" />
            {label}
          </label>
        ))}
      </div>

      {/* Karma throttle detail */}
      {form.karma_throttle && (
        <div className="grid grid-cols-2 gap-3 pl-4 border-l-2 border-gray-700">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Throttle below karma</label>
            <input type="number" min={0} value={form.karma_throttle_threshold}
              onChange={e => setForm(f => ({ ...f, karma_throttle_threshold: +e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Interval multiplier</label>
            <input type="number" min={1} max={10} step={0.5} value={form.karma_throttle_multiplier}
              onChange={e => setForm(f => ({ ...f, karma_throttle_multiplier: +e.target.value }))} className={inputCls} />
          </div>
        </div>
      )}

      <button onClick={handleSave} disabled={update.isPending}
        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
        <Save className="w-4 h-4" />
        {saved ? 'Saved!' : update.isPending ? 'Saving…' : 'Save Config'}
      </button>
    </div>
  )
}

// ── Claim flow guidance ──────────────────────────────────────────────────────

function ClaimFlowSection({ slot, onDone }: { slot: number; onDone: () => void }) {
  const claim = useClaimStatus(slot, true)
  const data = claim.data

  if (claim.isLoading) {
    return (
      <div className="border-t border-gray-800 pt-3 mt-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking claim status with Moltbook…
        </div>
      </div>
    )
  }

  if (!data || data.status === 'error') {
    return (
      <div className="border-t border-gray-800 pt-3 mt-3">
        <p className="text-xs text-red-400">{data?.message || 'Failed to check claim status'}</p>
        <button onClick={onDone} className="text-xs text-gray-500 hover:text-gray-300 mt-2">Dismiss</button>
      </div>
    )
  }

  if (data.status === 'claimed') {
    return (
      <div className="border-t border-gray-800 pt-3 mt-3">
        <div className="flex items-center gap-2 text-xs text-green-400">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          {data.message || 'Agent is claimed!'}
        </div>
        <p className="text-xs text-gray-500 mt-1">Local status updated automatically.</p>
        <button onClick={onDone} className="text-xs text-brand-400 hover:text-brand-300 mt-2">Done</button>
      </div>
    )
  }

  // pending_claim or not_registered
  return (
    <div className="border-t border-gray-800 pt-3 mt-3 space-y-3">
      <p className="text-sm font-medium text-amber-300">Claim your agent</p>
      <p className="text-xs text-gray-400">{data.message}</p>

      {data.claim_url && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Step 1: Open the claim link and follow the instructions</p>
          <a
            href={data.claim_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 bg-brand-950 border border-brand-800 rounded-lg px-3 py-2 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Claim {data.agent_name || 'agent'} on Moltbook
          </a>
          {data.next_step && (
            <p className="text-xs text-gray-500">Step 2: {data.next_step}</p>
          )}
          {data.hint && (
            <p className="text-xs text-gray-600 italic">{data.hint}</p>
          )}
        </div>
      )}

      {data.status === 'not_registered' && (
        <p className="text-xs text-gray-500">Register the agent first in the Config tab, then come back here.</p>
      )}

      <div className="flex gap-2">
        <button onClick={() => claim.refetch()} disabled={claim.isFetching}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
          {claim.isFetching ? 'Checking…' : 'Re-check status'}
        </button>
        <button onClick={onDone} className="text-xs text-gray-500 hover:text-gray-300">Dismiss</button>
      </div>
    </div>
  )
}

// ── Main detail page ─────────────────────────────────────────────────────────

export function AgentDetail() {
  const { slot } = useParams<{ slot: string }>()
  const slotNum = Number(slot)
  const agents = useAgents()
  const activity = useAgentActivity(slotNum, true)
  const posts = useAgentPosts(slotNum, true)
  const models = useModels()
  const start = useStartAgent()
  const stop = useStopAgent()
  const heartbeat = useTriggerHeartbeat()
  const toggleDryRun = useToggleDryRunMode()
  const interactPeers = useInteractWithPeers()

  const [tab, setTab] = useState<'activity' | 'config' | 'files' | 'posts'>('activity')
  const [activityFilter, setActivityFilter] = useState<'all' | 'actions' | 'skipped'>('all')
  const [showDebug, setShowDebug] = useState(false)
  const [showClaim, setShowClaim] = useState(false)
  const [dismissedErrorTs, setDismissedErrorTs] = useState<string | null>(null)

  const agent = agents.data?.find((a: Agent) => a.slot === slotNum)

  if (agents.isLoading) {
    return <div className="text-center py-12 text-gray-600">Loading…</div>
  }
  if (!agent) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-4">Agent not found</p>
        <Link to="/" className="text-brand-400 hover:text-brand-300 text-sm">Back to dashboard</Link>
      </div>
    )
  }

  const statusColor = agent.enabled ? 'bg-green-400' : 'bg-gray-600'
  const statusText = agent.enabled ? 'Enabled' : 'Disabled'
  const lastBeat = agent.state.last_heartbeat
    ? new Date(agent.state.last_heartbeat).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never'

  const moltbookProfileUrl = agent.registered
    ? `https://www.moltbook.com/u/${agent.persona.name}`
    : null

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <Link to="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-brand-900 flex items-center justify-center text-brand-300 text-xl font-bold">
                {agent.slot}
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-gray-950 ${statusColor}`} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-100">{agent.persona.name}</h1>
              <p className="text-sm text-gray-500">{agent.model} · {statusText}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {agent.enabled && (
              <>
                <button onClick={() => heartbeat.mutate(agent.slot)} disabled={heartbeat.isPending}
                  title="Trigger heartbeat" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-30">
                  {heartbeat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                </button>
                <button onClick={() => interactPeers.mutate(agent.slot)} disabled={interactPeers.isPending}
                  title="Interact with peers" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-30">
                  {interactPeers.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                </button>
                <button onClick={() => stop.mutate(agent.slot)} disabled={stop.isPending}
                  className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800/50 text-red-400 text-sm px-3 py-1.5 rounded-lg transition-colors">
                  {stop.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Disable
                </button>
              </>
            )}
            {!agent.enabled && agent.registered && (
              <button onClick={() => start.mutate(agent.slot)} disabled={start.isPending}
                className="flex items-center gap-1.5 bg-green-900/50 hover:bg-green-800/50 disabled:opacity-30 text-green-400 text-sm px-3 py-1.5 rounded-lg transition-colors">
                {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Enable
              </button>
            )}
            {agent.registered && (
              <button onClick={() => toggleDryRun.mutate(agent.slot)} disabled={toggleDryRun.isPending}
                title={agent.dry_run_mode ? "Disable dry run mode" : "Enable dry run mode — heartbeats won't post to Moltbook"}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 ${
                  agent.dry_run_mode
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-purple-900/50 hover:bg-purple-800/50 text-purple-400'
                }`}>
                {toggleDryRun.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Dry Run {agent.dry_run_mode ? 'On' : 'Off'}
              </button>
            )}
            <button onClick={() => {
              const backup = {
                slot: agent.slot,
                persona: agent.persona,
                schedule: agent.schedule,
                behavior: agent.behavior,
                model: agent.model,
                soul_md: agent.soul_md,
                heartbeat_md: agent.heartbeat_md,
                messaging_md: agent.messaging_md,
                rules_md: agent.rules_md,
                memory_md: agent.memory_md,
              }
              const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${agent.persona.name}-backup-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
              title="Backup agent config"
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats + links */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500">Karma</p>
            <p className="text-lg font-semibold text-gray-200">{agent.state.karma}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Last heartbeat</p>
            <p className="text-sm font-medium text-gray-200">{lastBeat}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Pending DMs</p>
            <p className={`text-lg font-semibold ${agent.state.pending_dm_requests.length > 0 ? 'text-amber-400' : 'text-gray-200'}`}>
              {agent.state.pending_dm_requests.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Registration</p>
            <p className="text-sm font-medium">
              {agent.registered
                ? agent.claimed
                  ? <span className="text-green-400">Claimed</span>
                  : <button onClick={() => setShowClaim(true)} className="text-amber-400 hover:text-amber-300 underline underline-offset-2 cursor-pointer">
                      Unclaimed — fix
                    </button>
                : <span className="text-gray-500">Not registered</span>}
            </p>
          </div>
        </div>

        {/* Claim flow guidance */}
        {showClaim && agent.registered && !agent.claimed && (
          <ClaimFlowSection slot={agent.slot} onDone={() => setShowClaim(false)} />
        )}

        {/* Links row */}
        <div className="flex flex-wrap gap-3 border-t border-gray-800 pt-3">
          {moltbookProfileUrl && (
            <a href={moltbookProfileUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors">
              <ExternalLink className="w-3 h-3" /> Moltbook Profile
            </a>
          )}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Key className="w-3 h-3" />
            <ApiKeyInline agent={agent} />
          </div>
        </div>
      </div>

      {/* Submolt warnings (not dismissable — goes away when fixed) */}
      {agent.behavior.invalid_submolts && agent.behavior.invalid_submolts.length > 0 && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-red-400 text-sm">!</span>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-red-300">Invalid submolt{agent.behavior.invalid_submolts.length > 1 ? 's' : ''}</h3>
              <p className="text-xs text-red-300/80 font-mono mt-1">
                {agent.behavior.invalid_submolts.map((s: string) => `m/${s}`).join(', ')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {agent.behavior.invalid_submolts.length > 1 ? 'These submolts don\'t' : 'This submolt doesn\'t'} exist on Moltbook. Posts targeting {agent.behavior.invalid_submolts.length > 1 ? 'them' : 'it'} will fail. Remove or replace in Config.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Last Error (shows if error occurred in last 4 heartbeats) */}
      {(() => {
        const entries = activity.data ?? []
        // Show error only if it occurred after the most recent heartbeat start
        const lastHeartbeat = entries.find((e: ActivityEntry) => e.action === 'heartbeat')
        const lastError = entries.find((e: ActivityEntry) => e.action === 'error')
        if (!lastError) return null
        if (lastHeartbeat && lastError.created_at <= lastHeartbeat.created_at) return null
        const detail = lastError.detail

        // Check if dismissed
        if (lastError.created_at === dismissedErrorTs) return null

        // Generate human-friendly explanation
        let explanation = ''
        if (detail.includes('500 Internal Server Error') || detail.includes('moltbook.com')) {
          explanation = 'Moltbook\'s server returned an error. This is on their end — the agent will retry automatically.'
        } else if (detail.includes('ReadTimeout') || detail.includes('ConnectTimeout')) {
          explanation = 'Moltbook\'s server didn\'t respond in time. This is usually a temporary Moltbook outage — the agent will retry.'
        } else if (detail.includes('400 Bad Request') || detail.includes('400 ')) {
          explanation = 'Moltbook rejected the request. This usually means the post content or submolt name failed validation. Check the error detail for the API response.'
        } else if (detail.includes('404 Not Found')) {
          explanation = 'The Moltbook API endpoint was not found. This can happen during Moltbook maintenance or API changes. Usually resolves on its own.'
        } else if (detail.includes('401') || detail.includes('403')) {
          explanation = 'The agent\'s API key was rejected. The key may have expired or the account may need to be re-claimed.'
        } else if (detail.includes('LLM') && (detail.includes('timeout') || detail.includes('Timeout'))) {
          explanation = 'The LLM took too long to respond. This happens when the GPU is busy. The agent will retry next heartbeat.'
        } else if (detail.includes('empty content')) {
          explanation = 'The LLM generated a response but it was empty after processing. This can happen with deepseek-r1 thinking models. The agent will try again.'
        } else if (detail.includes('Connection') || detail.includes('connection')) {
          explanation = 'Could not connect to the service. Check that Moltbook and the LLM runner are online.'
        } else if (detail.includes('lock')) {
          explanation = 'Another pod took over this agent\'s advisory lock. The agent will restart on the next deployment.'
        } else {
          explanation = 'An unexpected error occurred during the heartbeat cycle. Check the Logs tab for more details.'
        }

        return (
          <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-400 text-sm">!</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-medium text-red-300">Last Error</h3>
                  <span className="text-[10px] text-red-400/60">
                    {new Date(lastError.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-red-300/80 font-mono break-all mb-2">{detail}</p>
                <p className="text-xs text-gray-400">{explanation}</p>
              </div>
              <button
                onClick={() => setDismissedErrorTs(lastError.created_at)}
                className="text-red-400/60 hover:text-red-300 flex-shrink-0 p-1"
                title="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )
      })()}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800">
        {([
          ['activity', 'Activity'],
          ['posts', 'Posts'],
          ['config', 'Config'],
          ['files', 'Files'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium -mb-px transition-colors ${
              tab === id
                ? 'border-b-2 border-brand-500 text-gray-100'
                : 'text-gray-500 hover:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        {tab === 'activity' && (() => {
          const filtered = (activity.data ?? []).filter((e: ActivityEntry) => {
            if (!showDebug && DEBUG_ACTIONS.has(e.action)) return false
            if (activityFilter === 'all') return true
            if (activityFilter === 'skipped') return SKIPPED_ACTIONS.has(e.action)
            return !SKIPPED_ACTIONS.has(e.action) // 'actions'
          })
          const skippedCount = (activity.data ?? []).filter((e: ActivityEntry) => SKIPPED_ACTIONS.has(e.action)).length

          return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-gray-400">Recent Activity</h3>
                  {skippedCount > 0 && (
                    <span className="text-[10px] text-gray-600">{skippedCount} skipped</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
                    {(['all', 'actions', 'skipped'] as const).map(f => (
                      <button key={f} onClick={() => setActivityFilter(f)}
                        className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                          activityFilter === f
                            ? 'bg-gray-700 text-gray-200'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}>
                        {f === 'all' ? 'All' : f === 'actions' ? 'Actions' : 'Skipped'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowDebug(d => !d)}
                    className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                      showDebug ? 'bg-gray-700 text-gray-200' : 'text-gray-600 hover:text-gray-400'
                    }`}
                  >
                    Debug
                  </button>
                  {activity.isFetching && <RefreshCw className="w-3.5 h-3.5 text-gray-600 animate-spin" />}
                </div>
              </div>
              {filtered.length > 0 ? (
                <div className="space-y-0 max-h-[32rem] overflow-y-auto">
                  {filtered.map((e: ActivityEntry, i: number) => {
                    const isSkipped = SKIPPED_ACTIONS.has(e.action)
                    const color = ACTION_COLORS[e.action] ?? 'text-gray-400'
                    const ts = new Date(e.created_at).toLocaleString([], {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                    })
                    return (
                      <div key={i} className={`flex gap-3 text-xs py-2 border-b border-gray-800 last:border-0 ${isSkipped ? 'opacity-60' : ''}`}>
                        <span className="text-gray-600 flex-shrink-0 w-32">{ts}</span>
                        <span className={`${color} flex-shrink-0 w-28`}>{e.action}</span>
                        <span className="text-gray-400">{e.detail}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-600 py-4 text-center">
                  {activityFilter === 'skipped' ? 'No skipped actions logged.' : 'No activity yet. Start the agent and trigger a heartbeat.'}
                </p>
              )}
            </div>
          )
        })()}

        {tab === 'posts' && (
          <div className="space-y-1">
            {posts.data && posts.data.length > 0 ? posts.data.map((e: ActivityEntry, i: number) => {
              const ts = new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              // Extract UUID from brackets [post-id] or after "on post-id"
              const idMatch = e.detail.match(/\[([0-9a-f-]{36})\]/)
              const replyIdMatch = e.detail.match(/on ([0-9a-f-]{36})/)
              const postId = idMatch?.[1] || replyIdMatch?.[1]
              // For posts without ID, link to the submolt page
              const submoltMatch = e.detail.match(/→ m\/(\S+)/)
              const url = postId
                ? `https://www.moltbook.com/post/${postId}`
                : submoltMatch ? `https://www.moltbook.com/m/${submoltMatch[1]}` : null
              const isPost = e.action === 'posted' || e.action === 'manual_post'
              return (
                <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/30">
                  <span className="text-[10px] text-gray-600 pt-0.5 whitespace-nowrap">{ts}</span>
                  <span className={`text-xs font-medium ${isPost ? 'text-brand-400' : 'text-cyan-400'} min-w-[50px]`}>
                    {isPost ? 'Posted' : 'Replied'}
                  </span>
                  <span className="text-xs text-gray-300 flex-1 break-all">{e.detail}</span>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-400 hover:text-brand-300 whitespace-nowrap flex-shrink-0">
                      {postId ? 'View' : `m/${submoltMatch?.[1]}`}
                    </a>
                  )}
                </div>
              )
            }) : (
              <p className="text-xs text-gray-600 py-4 text-center">No posts or comments yet</p>
            )}
          </div>
        )}

        {tab === 'config' && models.data && (
          <ConfigEditor agent={agent} models={models.data} />
        )}

        {tab === 'files' && (
          <AgentFilesEditor agent={agent} />
        )}
      </div>
    </div>
  )
}
