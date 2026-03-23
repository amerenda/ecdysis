import { useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Square, Zap, Users, Loader2, Settings, RefreshCw,
  FileText, Upload, Key, Eye, EyeOff, Save, HelpCircle, ExternalLink, Filter,
} from 'lucide-react'
import {
  useAgents, useAgentActivity, useModels,
  useStartAgent, useStopAgent, useTriggerHeartbeat, useInteractWithPeers,
  useUpdateAgent, useClaimStatus,
} from '../hooks/useBackend'
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
  skipped_reply: 'text-gray-600',
  skipped_comment: 'text-gray-600',
  skipped_thread: 'text-gray-600',
  skipped_post: 'text-gray-600',
  skipped_peer_comment: 'text-gray-600',
}

const SKIPPED_ACTIONS = new Set(['skipped_reply', 'skipped_comment', 'skipped_thread', 'skipped_post', 'skipped_peer_comment'])

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

const AGENT_FILES: { key: string; label: string; description: string; editable: boolean; warning?: string; defaultContent: string }[] = [
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
]

function AgentFilesEditor({ agent }: { agent: Agent }) {
  const [selectedFile, setSelectedFile] = useState('soul_md')
  const fileConfig = AGENT_FILES.find(f => f.key === selectedFile)!
  const currentValue = (agent as any)[selectedFile] || ''
  const [value, setValue] = useState(currentValue)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const update = useUpdateAgent()

  // Sync value when switching files
  const prevFile = useRef(selectedFile)
  if (prevFile.current !== selectedFile) {
    prevFile.current = selectedFile
    setValue((agent as any)[selectedFile] || '')
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
              {f.label} {(agent as any)[f.key] ? `(${((agent as any)[f.key] as string).length} chars)` : '(empty)'}
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
          </>
        )}
        <span className="text-xs text-gray-600 ml-auto">{value.length} chars</span>
        <input ref={fileRef} type="file" accept=".md,.txt,.markdown" onChange={handleUpload} className="hidden" />
      </div>
    </div>
  )
}

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
    active_hours_start: agent.schedule.active_hours_start,
    active_hours_end: agent.schedule.active_hours_end,
    max_post_length: agent.behavior.max_post_length,
    auto_reply: agent.behavior.auto_reply,
    auto_like: agent.behavior.auto_like,
    reply_to_own_threads: agent.behavior.reply_to_own_threads,
    post_jitter_pct: agent.behavior.post_jitter_pct,
    karma_throttle: agent.behavior.karma_throttle,
    karma_throttle_threshold: agent.behavior.karma_throttle_threshold,
    karma_throttle_multiplier: agent.behavior.karma_throttle_multiplier,
    target_submolts: agent.behavior.target_submolts.join(', '),
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
          active_hours_start: form.active_hours_start,
          active_hours_end: form.active_hours_end,
        },
        behavior: {
          max_post_length: form.max_post_length,
          auto_reply: form.auto_reply,
          auto_like: form.auto_like,
          reply_to_own_threads: form.reply_to_own_threads,
          post_jitter_pct: form.post_jitter_pct,
          karma_throttle: form.karma_throttle,
          karma_throttle_threshold: form.karma_throttle_threshold,
          karma_throttle_multiplier: form.karma_throttle_multiplier,
          target_submolts: form.target_submolts.split(',').map((s: string) => s.trim()).filter(Boolean),
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
          {models.filter(m => m.fits !== false).map(m => (
            <option key={m.name} value={m.name}>{m.name} ({m.vram_estimate_gb} GB)</option>
          ))}
        </select>
      </div>

      {/* Persona */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Username</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="flex items-center text-xs text-gray-500 mb-1">Tone <Tip text="Short style directive (e.g. 'dry wit, concise'). Complements SOUL.md — tone is a quick summary, SOUL.md has the full personality definition." /></label>
          <input value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))} className={inputCls} />
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
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Post jitter ({form.post_jitter_pct}%)</label>
        <input type="range" min={0} max={50} step={5} value={form.post_jitter_pct}
          onChange={e => setForm(f => ({ ...f, post_jitter_pct: +e.target.value }))} className="w-full accent-brand-500" />
      </div>

      {/* Target submolts */}
      <div>
        <label className="flex items-center text-xs text-gray-500 mb-1">Target submolts <Tip text="Communities to post in. Leave blank to derive from topics." /></label>
        <input value={form.target_submolts} onChange={e => setForm(f => ({ ...f, target_submolts: e.target.value }))} placeholder="technology, science" className={inputCls} />
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
  const models = useModels()
  const start = useStartAgent()
  const stop = useStopAgent()
  const heartbeat = useTriggerHeartbeat()
  const interactPeers = useInteractWithPeers()

  const [tab, setTab] = useState<'activity' | 'config' | 'files'>('activity')
  const [activityFilter, setActivityFilter] = useState<'all' | 'actions' | 'skipped'>('all')
  const [showClaim, setShowClaim] = useState(false)

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

  const statusColor = agent.running ? 'bg-green-400' : 'bg-gray-600'
  const statusText = agent.running ? 'Running' : agent.enabled ? 'Stopped' : 'Inactive'
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
            {!agent.running ? (
              <button onClick={() => start.mutate(agent.slot)} disabled={!agent.registered || start.isPending}
                className="flex items-center gap-1.5 bg-green-900/50 hover:bg-green-800/50 disabled:opacity-30 text-green-400 text-sm px-3 py-1.5 rounded-lg transition-colors">
                {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start
              </button>
            ) : (
              <>
                <button onClick={() => heartbeat.mutate(agent.slot)} disabled={heartbeat.isPending}
                  title="Trigger heartbeat" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
                  {heartbeat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                </button>
                <button onClick={() => interactPeers.mutate(agent.slot)} disabled={interactPeers.isPending}
                  title="Interact with peers" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
                  {interactPeers.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                </button>
                <button onClick={() => stop.mutate(agent.slot)} disabled={stop.isPending}
                  className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800/50 text-red-400 text-sm px-3 py-1.5 rounded-lg transition-colors">
                  {stop.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Stop
                </button>
              </>
            )}
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

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800">
        {([
          ['activity', 'Activity'],
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
