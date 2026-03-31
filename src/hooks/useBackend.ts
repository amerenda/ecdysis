import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Agent, GpuInfo, OllamaModel, ActivityEntry, VramCheck,
  PlaygroundBrowseResult, PlaygroundPostResult, PlaygroundCommentResult, PlaygroundLiveResult,
} from '../types'

const BASE = ''  // nginx proxies /api to llm-manager backend

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

// ── Health ────────────────────────────────────────────────────────────────────

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => get<{ ok: boolean; backend: string; is_uat?: boolean }>('/health'),
    refetchInterval: 10_000,
    retry: 0,
  })
}

// ── GPU & Models ──────────────────────────────────────────────────────────────

export function useGpu() {
  return useQuery<GpuInfo>({
    queryKey: ['gpu'],
    queryFn: () => get('/api/gpu'),
  })
}

export function useModels() {
  return useQuery<OllamaModel[]>({
    queryKey: ['models'],
    queryFn: () => get('/api/models'),
    select: (data) => [...data].sort((a, b) => a.name.localeCompare(b.name)),
  })
}

export function useVramCheck(models: string[]) {
  return useQuery<VramCheck>({
    queryKey: ['vram', models],
    queryFn: () => post('/api/vram-check', { models }),
    enabled: models.length > 0,
  })
}

// ── Agents ────────────────────────────────────────────────────────────────────

export function useAgents() {
  return useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => get('/api/agents'),
    refetchInterval: 5_000,
  })
}

export function useAgentActivity(slot: number, enabled: boolean) {
  return useQuery<ActivityEntry[]>({
    queryKey: ['activity', slot],
    queryFn: () => get(`/api/agents/${slot}/activity`),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useUpdateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slot, data }: { slot: number; data: unknown }) =>
      patch(`/api/agents/${slot}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useDeleteAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (slot: number) => {
      const r = await fetch(`/api/agents/${slot}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useStartAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useStopAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/stop`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useRegisterAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slot, name, description }: { slot: number; name: string; description: string }) =>
      post(`/api/agents/${slot}/register`, { name, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useMarkClaimed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/mark-claimed`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export interface ClaimStatus {
  status: string
  message: string
  claim_url: string
  agent_name: string
  next_step: string
  hint: string
}

export function useClaimStatus(slot: number, enabled: boolean) {
  return useQuery<ClaimStatus>({
    queryKey: ['claim-status', slot],
    queryFn: () => get(`/api/agents/${slot}/claim-status`),
    enabled,
  })
}

export function useSetupOwnerEmail() {
  return useMutation({
    mutationFn: ({ slot, email }: { slot: number; email: string }) =>
      post(`/api/agents/${slot}/setup-owner-email`, { email }),
  })
}


export function useTriggerHeartbeat() {
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/heartbeat`),
  })
}

export interface DryRunAction {
  type: string
  title?: string
  content?: string
  submolt?: string
  post_id?: string
  parent_id?: string
}

export function useDryRunHeartbeat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post<{ ok: boolean; dry_run: boolean; actions: DryRunAction[] }>(
      `/api/agents/${slot}/heartbeat?dry_run=true`
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity'] })
      qc.invalidateQueries({ queryKey: ['prompt-log'] })
    },
  })
}

export function useToggleDryRunMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/dry-run-mode`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useInteractWithPeers() {
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/interact-with-peers`),
  })
}

export function useCompactMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/compact-memory`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })
}

export function useAgentPosts(slot: number, enabled: boolean) {
  return useQuery<ActivityEntry[]>({
    queryKey: ['agent-posts', slot],
    queryFn: () => get(`/api/agents/${slot}/posts`),
    enabled,
    refetchInterval: 60_000,
  })
}

// ── System Logs ─────────────────────────────────────────────────────────────

export interface SystemLog {
  id: number
  source: string
  level: string
  logger_name: string
  message: string
  pod_name: string
  created_at: string
}

export function useSystemLogs(source?: string, level?: string, slot?: number) {
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  if (level) params.set('level', level)
  if (slot !== undefined) params.set('slot', String(slot))
  params.set('limit', '200')
  const query = params.toString()
  return useQuery<SystemLog[]>({
    queryKey: ['system-logs', source, level, slot],
    queryFn: () => get(`/api/logs?${query}`),
    refetchInterval: 5_000,
  })
}

// ── Prompt Log ──────────────────────────────────────────────────────────────

export interface PromptLogEntry {
  slot: number
  model: string
  system: string
  prompt: string
  response: string
  timestamp: string
}

export interface PromptLogResponse {
  pod: string
  entries: PromptLogEntry[]
}

export function usePromptLog(slot?: number) {
  const params = slot !== undefined ? `?slot=${slot}` : ''
  return useQuery<PromptLogResponse>({
    queryKey: ['prompt-log', slot],
    queryFn: () => get(`/api/prompts${params}`),
    refetchInterval: 15_000,
  })
}

// ── Global Config ───────────────────────────────────────────────────────────

export function useCommonConfig() {
  return useQuery<{ common_md: string }>({
    queryKey: ['common-config'],
    queryFn: () => get('/api/config/common'),
  })
}

export function useUpdateCommonConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (common_md: string) => put('/api/config/common', { common_md }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['common-config'] }),
  })
}

export function useResetDatabase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post('/api/admin/reset-database'),
    onSuccess: () => qc.invalidateQueries(),
  })
}

// ── Playground ─────────────────────────────────────────────────────────────

export interface PlaygroundOverrides {
  soul_md?: string
  rules_md?: string
  heartbeat_md?: string
  messaging_md?: string
}

export function usePlaygroundBrowse() {
  return useMutation({
    mutationFn: ({ slot, overrides }: { slot: number; overrides?: PlaygroundOverrides }) =>
      post<PlaygroundBrowseResult>(`/api/agents/${slot}/playground/browse`, overrides || {}),
  })
}

export function usePlaygroundPost() {
  return useMutation({
    mutationFn: ({ slot, overrides }: { slot: number; overrides?: PlaygroundOverrides }) =>
      post<PlaygroundPostResult>(`/api/agents/${slot}/playground/post`, overrides || {}),
  })
}

export function usePlaygroundComment() {
  return useMutation({
    mutationFn: ({ slot, overrides }: { slot: number; overrides?: PlaygroundOverrides }) =>
      post<PlaygroundCommentResult>(`/api/agents/${slot}/playground/comment`, overrides || {}),
  })
}

export function usePlaygroundPostLive() {
  return useMutation({
    mutationFn: ({ slot, submolt, title, content }: { slot: number; submolt: string; title: string; content: string }) =>
      post<PlaygroundLiveResult>(`/api/agents/${slot}/playground/post-live`, { submolt, title, content }),
  })
}

export function usePlaygroundCommentLive() {
  return useMutation({
    mutationFn: ({ slot, post_id, content, parent_id }: { slot: number; post_id: string; content: string; parent_id?: string }) =>
      post<PlaygroundLiveResult>(`/api/agents/${slot}/playground/comment-live`, { post_id, content, parent_id }),
  })
}
