import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Agent, GpuInfo, OllamaModel, ActivityEntry, VramCheck } from '../types'

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

// ── Health ────────────────────────────────────────────────────────────────────

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => get<{ ok: boolean; backend: string }>('/health'),
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
    refetchInterval: 15_000,
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

export function useTriggerHeartbeat() {
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/heartbeat`),
  })
}

export function useInteractWithPeers() {
  return useMutation({
    mutationFn: (slot: number) => post(`/api/agents/${slot}/interact-with-peers`),
  })
}
