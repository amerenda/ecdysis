import { useState } from 'react'
import { CheckCircle, ExternalLink, AlertTriangle } from 'lucide-react'
import { useRegisterAgent, useMarkClaimed } from '../hooks/useBackend'
import type { Agent } from '../types'

interface Props {
  agent: Agent
}

type Step = 'name' | 'register' | 'claim' | 'done'

export function RegistrationWizard({ agent }: Props) {
  const [step, setStep] = useState<Step>(
    agent.claimed ? 'done' : agent.registered ? 'claim' : 'name'
  )
  const [name, setName] = useState(agent.persona.name)
  const [desc, setDesc] = useState(agent.persona.description)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const register = useRegisterAgent()
  const markClaimed = useMarkClaimed()

  async function handleRegister() {
    setError(null)
    try {
      const r = await register.mutateAsync({ slot: agent.slot, name, description: desc })
      setResult((r as any).api_key_preview ?? null)
      setStep('claim')
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleMarkClaimed() {
    await markClaimed.mutateAsync(agent.slot)
    setStep('done')
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'name', label: 'Name & Bio' },
    { key: 'register', label: 'Register' },
    { key: 'claim', label: 'Claim' },
    { key: 'done', label: 'Done' },
  ]

  const stepIndex = steps.findIndex(s => s.key === step)

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              i < stepIndex ? 'bg-brand-600 text-white' :
              i === stepIndex ? 'bg-brand-500 text-white ring-2 ring-brand-400 ring-offset-2 ring-offset-gray-900' :
              'bg-gray-800 text-gray-500'
            }`}>
              {i < stepIndex ? '✓' : i + 1}
            </div>
            <span className={`text-xs ${i === stepIndex ? 'text-gray-200' : 'text-gray-500'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-gray-700" />}
          </div>
        ))}
      </div>

      {/* Step: Name */}
      {step === 'name' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Agent name (Moltbook username)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-brand-500"
              placeholder="e.g. aria_thinks"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Short bio (shown on Moltbook profile)</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-brand-500 resize-none"
              placeholder="What is this agent about?"
            />
          </div>
          <button
            onClick={() => setStep('register')}
            disabled={!name.trim() || !desc.trim()}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Register */}
      {step === 'register' && (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Name</span>
              <span className="text-gray-200">{name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Bio</span>
              <span className="text-gray-200 text-right max-w-xs truncate">{desc}</span>
            </div>
          </div>

          <p className="text-sm text-gray-400">
            This will call the Moltbook API to create the agent account and save the API key.
          </p>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep('name')}
              className="text-sm text-gray-400 hover:text-gray-200 px-4 py-2 rounded-lg border border-gray-700 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleRegister}
              disabled={register.isPending}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {register.isPending ? 'Registering…' : 'Register on Moltbook'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Claim */}
      {step === 'claim' && (
        <div className="space-y-4">
          {result && (
            <div className="bg-green-950/30 border border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-300 font-medium">Registered successfully</p>
              <p className="text-xs text-green-400 mt-1">API key saved (preview: {result})</p>
            </div>
          )}

          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-sm text-gray-200 font-medium">Claim your agent</p>
            <p className="text-sm text-gray-400">
              Moltbook sent a claim link to your X (Twitter) DMs. Open the link to verify
              ownership — the agent cannot post until it's claimed.
            </p>
            <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
              <li>Check your X DMs for a message from Moltbook</li>
              <li>Click the claim link in the DM</li>
              <li>Verify your identity on the Moltbook site</li>
            </ol>
            <a
              href="https://x.com/messages"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300"
            >
              Open X DMs <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <button
            onClick={handleMarkClaimed}
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            I've claimed the agent
          </button>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="flex items-center gap-3 bg-green-950/30 border border-green-800 rounded-xl p-4">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-300">Agent ready</p>
            <p className="text-xs text-green-500 mt-0.5">
              {agent.persona.name} is registered and claimed. Go to the Dashboard to start it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
