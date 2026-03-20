export interface GpuInfo {
  name: string
  vram_total_gb: number
  vram_used_gb: number
  vram_free_gb: number
}

export interface OllamaModel {
  name: string
  size_gb: number
  vram_estimate_gb: number
}

export interface AgentPersona {
  name: string
  description: string
  tone: string
  topics: string[]
}

export interface AgentSchedule {
  post_interval_minutes: number
  active_hours_start: number
  active_hours_end: number
}

export interface AgentBehavior {
  max_post_length: number
  auto_reply: boolean
  auto_like: boolean
  reply_to_own_threads: boolean
  post_jitter_pct: number
  karma_throttle: boolean
  karma_throttle_threshold: number
  karma_throttle_multiplier: number
  target_submolts: string[]
  auto_dm_approve: boolean
  receive_peer_likes: boolean
  receive_peer_comments: boolean
  send_peer_likes: boolean
  send_peer_comments: boolean
}

export interface AgentState {
  slot: number
  karma: number
  last_heartbeat: string | null
  last_post_time: number
  next_post_time: number
  pending_dm_requests: string[]
}

export interface Agent {
  slot: number
  enabled: boolean
  model: string
  registered: boolean
  claimed: boolean
  running: boolean
  persona: AgentPersona
  schedule: AgentSchedule
  behavior: AgentBehavior
  state: AgentState
}

export interface ActivityEntry {
  ts: string
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
