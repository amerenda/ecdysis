export interface RunnerGpuInfo {
  name: string
  runner_id: number
  vram_total_gb: number
  vram_used_gb: number
  vram_free_gb: number
}

export interface GpuInfo {
  vram_total_gb: number
  vram_used_gb: number
  vram_free_gb: number
  runners: RunnerGpuInfo[]
}

export interface OllamaModel {
  name: string
  size_gb: number
  vram_estimate_gb: number
  fits: boolean
  fits_on: { runner: string; vram_total_gb: number }[]
}

export interface AgentPersona {
  name: string
  description: string
  tone: string
  topics: string[]
}

export interface AgentSchedule {
  post_interval_minutes: number
  heartbeat_interval_minutes: number
  heartbeat_jitter_pct: number
  active_hours_start: number
  active_hours_end: number
}

export interface AgentBehavior {
  max_post_length: number
  auto_reply: boolean
  auto_like: boolean
  reply_to_own_threads: boolean
  max_replies_per_heartbeat: number
  max_comments_per_post: number
  post_jitter_pct: number
  karma_throttle: boolean
  karma_throttle_threshold: number
  karma_throttle_multiplier: number
  target_submolts: string[]
  exclude_submolts: string[]
  invalid_submolts: string[]
  auto_dm_approve: boolean
  receive_peer_likes: boolean
  receive_peer_comments: boolean
  send_peer_likes: boolean
  send_peer_comments: boolean
  log_skipped: boolean
}

export interface AgentState {
  slot: number
  karma: number
  last_heartbeat: string | null
  last_post_time: number
  next_post_time: number
  pending_dm_requests: string[]
  rate_limited_until: string | null
}

export interface Agent {
  slot: number
  enabled: boolean
  model: string
  llm_runner_id: number | null
  api_key: string
  registered: boolean
  claimed: boolean
  has_recent_error: boolean
  heartbeat_state: 'idle' | 'active' | 'queued'
  running: boolean
  soul_md: string
  heartbeat_md: string
  messaging_md: string
  rules_md: string
  memory_md: string
  persona: AgentPersona
  schedule: AgentSchedule
  behavior: AgentBehavior
  state: AgentState
}

export interface ActivityEntry {
  created_at: string
  action: string
  detail: string
}

export interface VramCheck {
  total_vram_needed_gb: number
  gpu_vram_gb: number
  fits_simultaneously: boolean
  per_model: { model: string; vram_gb: number }[]
  warning: string | null
}
