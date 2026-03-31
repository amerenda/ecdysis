import { useState, useEffect } from 'react'
import { Loader2, Send, MessageSquare, ThumbsUp, Save, AlertCircle, Check, Eye } from 'lucide-react'
import {
  useAgents, useUpdateAgent, useCommonConfig, useUpdateCommonConfig,
  usePlaygroundWarm, usePlaygroundBrowse, usePlaygroundPost, usePlaygroundComment,
  usePlaygroundPostLive, usePlaygroundCommentLive,
} from '../hooks/useBackend'
import type {
  Agent, PlaygroundBrowsePost, PlaygroundPostResult, PlaygroundCommentEntry,
} from '../types'

// ── Post card (used in browse + comment results) ────────────────────────────

function PostCard({ post, children }: { post: { title: string; content: string; author: string; submolt: string; upvotes?: number; comment_count?: number }; children?: React.ReactNode }) {
  return (
    <div className="border border-gray-700 rounded-lg bg-gray-800/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
          <span className="text-gray-400 font-medium">@{post.author}</span>
          {post.submolt && <span>in <span className="text-brand-400">m/{post.submolt}</span></span>}
          {post.upvotes !== undefined && <span>{post.upvotes} upvotes</span>}
          {post.comment_count !== undefined && <span>{post.comment_count} comments</span>}
        </div>
        <h3 className="text-sm font-semibold text-gray-100">{post.title}</h3>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-gray-300 whitespace-pre-wrap">{post.content}</p>
      </div>
      {children}
    </div>
  )
}

// ── Browse results ──────────────────────────────────────────────────────────

function BrowseResults({ posts, slot }: { posts: PlaygroundBrowsePost[]; slot: number }) {
  const postLive = usePlaygroundCommentLive()
  const [postedComments, setPostedComments] = useState<Set<string>>(new Set())

  function handleCommentLive(post: PlaygroundBrowsePost) {
    postLive.mutate(
      { slot, post_id: post.id, content: post.generated_comment },
      { onSuccess: (r) => { if (r.ok) setPostedComments(s => new Set(s).add(post.id)) } },
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        {posts.length} posts from feed — {posts.filter(p => p.would_upvote).length} would upvote, {posts.filter(p => p.would_comment).length} would comment
      </div>
      {posts.map(post => (
        <PostCard key={post.id} post={post}>
          <div className="px-4 py-2 border-t border-gray-700/50 space-y-2">
            {/* Upvote badge */}
            <div className="flex items-center gap-2">
              {post.would_upvote ? (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-800">
                  <ThumbsUp className="w-3 h-3" /> Would upvote
                  {post.upvote_reason && <span className="text-green-600 ml-1">({post.upvote_reason})</span>}
                </span>
              ) : (
                <span className="text-xs text-gray-600">Would not upvote</span>
              )}
            </div>

            {/* Comment preview */}
            {post.would_comment && post.generated_comment && (
              <div className="mt-2">
                <div className="text-xs text-blue-400 mb-1 font-medium flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Would comment:
                </div>
                <div className="bg-blue-950/30 border border-blue-900/50 rounded px-3 py-2 text-sm text-gray-200">
                  {post.generated_comment}
                </div>
                <div className="mt-2 flex justify-end">
                  {postedComments.has(post.id) ? (
                    <span className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Posted</span>
                  ) : (
                    <button
                      onClick={() => handleCommentLive(post)}
                      disabled={postLive.isPending}
                      className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> Comment Live
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </PostCard>
      ))}
    </div>
  )
}

// ── Post preview ────────────────────────────────────────────────────────────

function PostPreview({ result, slot, agentName }: { result: PlaygroundPostResult; slot: number; agentName: string }) {
  const postLive = usePlaygroundPostLive()
  const [posted, setPosted] = useState(false)

  if (result.error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" /> {result.error}
      </div>
    )
  }

  function handlePostLive() {
    if (!result.submolt || !result.title || !result.content) return
    postLive.mutate(
      { slot, submolt: result.submolt, title: result.title, content: result.content },
      { onSuccess: (r) => { if (r.ok) setPosted(true) } },
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        Target: <span className="text-brand-400">m/{result.submolt}</span>
        <span className="text-gray-600 ml-2">({result.submolt_selection_reason})</span>
      </div>
      <PostCard post={{ title: result.title || '', content: result.content || '', author: agentName, submolt: result.submolt || '' }}>
        <div className="px-4 py-2 border-t border-gray-700/50 flex justify-end">
          {posted ? (
            <span className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Posted</span>
          ) : (
            <button
              onClick={handlePostLive}
              disabled={postLive.isPending}
              className="text-xs px-3 py-1 rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 flex items-center gap-1"
            >
              {postLive.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Post Live
            </button>
          )}
          {postLive.isError && <span className="text-xs text-red-400 ml-2">Failed: {String(postLive.error)}</span>}
        </div>
      </PostCard>
    </div>
  )
}

// ── Comment preview ─────────────────────────────────────────────────────────

function CommentResults({ comments, slot }: { comments: PlaygroundCommentEntry[]; slot: number }) {
  const commentLive = usePlaygroundCommentLive()
  const [postedComments, setPostedComments] = useState<Set<string>>(new Set())

  function handleCommentLive(c: PlaygroundCommentEntry) {
    commentLive.mutate(
      { slot, post_id: c.post_id, content: c.generated_comment, parent_id: c.parent_comment ? undefined : undefined },
      { onSuccess: (r) => { if (r.ok) setPostedComments(s => new Set(s).add(c.post_id)) } },
    )
  }

  if (comments.length === 0) {
    return <div className="text-sm text-gray-500">No posts the agent would comment on right now.</div>
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">{comments.length} post{comments.length !== 1 ? 's' : ''} the agent would comment on</div>
      {comments.map(c => (
        <PostCard key={c.post_id} post={{ title: c.post_title, content: c.post_content, author: c.post_author, submolt: c.post_submolt }}>
          <div className="px-4 py-2 border-t border-gray-700/50 space-y-2">
            {/* Parent comment if replying to one */}
            {c.parent_comment && (
              <div className="bg-gray-900/50 border border-gray-700 rounded px-3 py-2">
                <div className="text-xs text-gray-500 mb-1">@{c.parent_comment.author} replied:</div>
                <p className="text-sm text-gray-300">{c.parent_comment.content}</p>
              </div>
            )}

            {/* Agent's comment */}
            <div>
              <div className="text-xs text-blue-400 mb-1 font-medium flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Agent would comment:
              </div>
              <div className="bg-blue-950/30 border border-blue-900/50 rounded px-3 py-2 text-sm text-gray-200">
                {c.generated_comment}
              </div>
            </div>

            <div className="flex justify-end">
              {postedComments.has(c.post_id) ? (
                <span className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Posted</span>
              ) : (
                <button
                  onClick={() => handleCommentLive(c)}
                  disabled={commentLive.isPending}
                  className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 flex items-center gap-1"
                >
                  <Send className="w-3 h-3" /> Comment Live
                </button>
              )}
            </div>
          </div>
        </PostCard>
      ))}
    </div>
  )
}

// ── Config file tabs ────────────────────────────────────────────────────────

const FILE_TABS = ['SOUL.md', 'RULES.md', 'HEARTBEAT.md', 'MESSAGING.md', 'MEMORY.md', 'COMMON.md'] as const
type FileTab = typeof FILE_TABS[number]

const FILE_KEY_MAP: Record<FileTab, string> = {
  'SOUL.md': 'soul_md',
  'RULES.md': 'rules_md',
  'HEARTBEAT.md': 'heartbeat_md',
  'MESSAGING.md': 'messaging_md',
  'MEMORY.md': 'memory_md',
  'COMMON.md': 'common_md',
}

// ── Main Playground component ───────────────────────────────────────────────

export function Playground() {
  const { data: agents } = useAgents()
  const commonConfig = useCommonConfig()
  const updateAgent = useUpdateAgent()
  const updateCommon = useUpdateCommonConfig()

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [activeFileTab, setActiveFileTab] = useState<FileTab>('SOUL.md')
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({})
  const [hasEdits, setHasEdits] = useState(false)
  const [saveConfirm, setSaveConfirm] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  // Results state
  const [activeAction, setActiveAction] = useState<'browse' | 'post' | 'comment' | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [warmingModel, setWarmingModel] = useState(false)

  const warm = usePlaygroundWarm()
  const browse = usePlaygroundBrowse()
  const genPost = usePlaygroundPost()
  const genComment = usePlaygroundComment()

  const configured = agents?.filter(a => a.registered && a.api_key) || []
  const selectedAgent = configured.find(a => a.slot === selectedSlot) || null

  // Load agent files and warm model when selection changes
  useEffect(() => {
    if (selectedAgent) {
      const files: Record<string, string> = {
        soul_md: selectedAgent.soul_md || '',
        rules_md: selectedAgent.rules_md || '',
        heartbeat_md: selectedAgent.heartbeat_md || '',
        messaging_md: selectedAgent.messaging_md || '',
        memory_md: selectedAgent.memory_md || '',
        common_md: commonConfig.data?.common_md || '',
      }
      setEditedFiles(files)
      setHasEdits(false)
      setSaveConfirm(false)
      setSaveResult(null)
      setActiveAction(null)
      setModelReady(false)
      setWarmingModel(true)
      warm.mutate(selectedAgent.slot, {
        onSuccess: () => { setModelReady(true); setWarmingModel(false) },
        onError: () => { setWarmingModel(false) },
      })
    }
  }, [selectedSlot])

  function updateFile(key: string, value: string) {
    setEditedFiles(prev => ({ ...prev, [key]: value }))
    setHasEdits(true)
  }

  function getOverrides() {
    if (!selectedAgent) return {}
    const o: Record<string, string> = {}
    if (editedFiles.soul_md !== (selectedAgent.soul_md || '')) o.soul_md = editedFiles.soul_md
    if (editedFiles.rules_md !== (selectedAgent.rules_md || '')) o.rules_md = editedFiles.rules_md
    if (editedFiles.heartbeat_md !== (selectedAgent.heartbeat_md || '')) o.heartbeat_md = editedFiles.heartbeat_md
    if (editedFiles.messaging_md !== (selectedAgent.messaging_md || '')) o.messaging_md = editedFiles.messaging_md
    if (editedFiles.common_md !== (commonConfig.data?.common_md || '')) o.common_md = editedFiles.common_md
    return o
  }

  function handleBrowse() {
    if (!selectedSlot) return
    setActiveAction('browse')
    browse.mutate({ slot: selectedSlot, overrides: getOverrides() })
  }

  function handlePost() {
    if (!selectedSlot) return
    setActiveAction('post')
    genPost.mutate({ slot: selectedSlot, overrides: getOverrides() })
  }

  function handleComment() {
    if (!selectedSlot) return
    setActiveAction('comment')
    genComment.mutate({ slot: selectedSlot, overrides: getOverrides() })
  }

  async function handleSave() {
    if (!selectedSlot || !selectedAgent) return
    const agentUpdates: Record<string, string> = {}
    if (editedFiles.soul_md !== (selectedAgent.soul_md || '')) agentUpdates.soul_md = editedFiles.soul_md
    if (editedFiles.rules_md !== (selectedAgent.rules_md || '')) agentUpdates.rules_md = editedFiles.rules_md
    if (editedFiles.heartbeat_md !== (selectedAgent.heartbeat_md || '')) agentUpdates.heartbeat_md = editedFiles.heartbeat_md
    if (editedFiles.messaging_md !== (selectedAgent.messaging_md || '')) agentUpdates.messaging_md = editedFiles.messaging_md

    const commonChanged = editedFiles.common_md !== (commonConfig.data?.common_md || '')

    try {
      if (Object.keys(agentUpdates).length > 0) {
        await updateAgent.mutateAsync({ slot: selectedSlot, data: agentUpdates })
      }
      if (commonChanged) {
        await updateCommon.mutateAsync(editedFiles.common_md)
      }
      setHasEdits(false)
      setSaveConfirm(false)
      setSaveResult('Saved')
      setTimeout(() => setSaveResult(null), 3000)
    } catch (e) {
      setSaveResult(`Error: ${e}`)
    }
  }

  const isLoading = browse.isPending || genPost.isPending || genComment.isPending

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-100">Playground</h1>

      {/* Agent selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedSlot ?? ''}
          onChange={e => setSelectedSlot(e.target.value ? Number(e.target.value) : null)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">Select an agent...</option>
          {configured.map(a => (
            <option key={a.slot} value={a.slot}>
              Slot {a.slot}: {a.persona.name} {a.running ? '(running)' : a.enabled ? '(enabled)' : '(disabled)'}
            </option>
          ))}
        </select>

        {selectedAgent && (
          <div className="text-xs text-gray-500 flex items-center gap-3">
            <span>Model: <span className="text-gray-400">{selectedAgent.model}</span></span>
            <span>Karma: <span className="text-gray-400">{selectedAgent.state.karma}</span></span>
            {warmingModel && (
              <span className="text-amber-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading model...
              </span>
            )}
            {modelReady && !warmingModel && (
              <span className="text-green-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Model ready
              </span>
            )}
          </div>
        )}
      </div>

      {!selectedAgent && configured.length === 0 && (
        <div className="text-sm text-gray-500">No registered agents found. Register an agent on the Setup page first.</div>
      )}

      {selectedAgent && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left panel — Config editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-300">Agent Files</h2>
              {hasEdits && (
                <div className="flex items-center gap-2">
                  {saveConfirm ? (
                    <>
                      <span className="text-xs text-amber-400">Save changes to agent?</span>
                      <button onClick={handleSave} className="text-xs px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white">Yes, save</button>
                      <button onClick={() => setSaveConfirm(false)} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300">Cancel</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setSaveConfirm(true)}
                      className="text-xs px-3 py-1 rounded bg-brand-700 hover:bg-brand-600 text-white flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" /> Save to Agent
                    </button>
                  )}
                </div>
              )}
              {saveResult && (
                <span className={`text-xs ${saveResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{saveResult}</span>
              )}
            </div>

            {/* File tabs */}
            <div className="flex gap-1 flex-wrap">
              {FILE_TABS.map(tab => {
                const key = FILE_KEY_MAP[tab]
                const isEdited = selectedAgent && (
                  tab === 'COMMON.md'
                    ? editedFiles[key] !== (commonConfig.data?.common_md || '')
                    : editedFiles[key] !== ((selectedAgent as unknown as Record<string, unknown>)[key] || '')
                )
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveFileTab(tab)}
                    className={`text-xs px-2.5 py-1 rounded transition-colors ${
                      activeFileTab === tab
                        ? 'bg-brand-900 text-brand-300'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    {tab}
                    {isEdited && <span className="text-amber-400 ml-1">*</span>}
                  </button>
                )
              })}
            </div>

            {/* Editor */}
            <textarea
              value={editedFiles[FILE_KEY_MAP[activeFileTab]] || ''}
              onChange={e => updateFile(FILE_KEY_MAP[activeFileTab], e.target.value)}
              readOnly={activeFileTab === 'MEMORY.md'}
              className={`w-full h-64 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono resize-y focus:ring-brand-500 focus:border-brand-500 ${
                activeFileTab === 'MEMORY.md' ? 'opacity-60 cursor-not-allowed' : ''
              }`}
              placeholder={activeFileTab === 'MEMORY.md' ? 'Memory is auto-generated (read-only)' : `Enter ${activeFileTab} content...`}
            />
            {activeFileTab === 'COMMON.md' && (
              <div className="text-xs text-gray-600">Global prompt injected into all LLM calls for all agents.</div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleBrowse}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 disabled:opacity-50 transition-colors"
              >
                {browse.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Browse & Upvote
              </button>
              <button
                onClick={handlePost}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 disabled:opacity-50 transition-colors"
              >
                {genPost.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Post
              </button>
              <button
                onClick={handleComment}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 disabled:opacity-50 transition-colors"
              >
                {genComment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Comment
              </button>
            </div>
          </div>

          {/* Right panel — Results */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-gray-300">
              {activeAction === 'browse' ? 'Browse Results' : activeAction === 'post' ? 'Generated Post' : activeAction === 'comment' ? 'Comment Targets' : 'Results'}
            </h2>

            {!activeAction && !isLoading && (
              <div className="text-sm text-gray-500 border border-dashed border-gray-700 rounded-lg p-8 text-center">
                Select an action to preview agent behavior with live Moltbook data.
              </div>
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
                Running LLM inference and fetching live data...
              </div>
            )}

            {/* Browse results */}
            {activeAction === 'browse' && browse.data && !browse.isPending && (
              <BrowseResults posts={browse.data.posts} slot={selectedSlot!} />
            )}
            {activeAction === 'browse' && browse.isError && (
              <div className="text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {String(browse.error)}
              </div>
            )}

            {/* Post result */}
            {activeAction === 'post' && genPost.data && !genPost.isPending && (
              <PostPreview result={genPost.data} slot={selectedSlot!} agentName={selectedAgent.persona.name} />
            )}
            {activeAction === 'post' && genPost.isError && (
              <div className="text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {String(genPost.error)}
              </div>
            )}

            {/* Comment results */}
            {activeAction === 'comment' && genComment.data && !genComment.isPending && (
              <CommentResults comments={genComment.data.comments} slot={selectedSlot!} />
            )}
            {activeAction === 'comment' && genComment.isError && (
              <div className="text-sm text-red-400 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {String(genComment.error)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
