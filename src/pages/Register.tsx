import { useAgents } from '../hooks/useBackend'
import { RegistrationWizard } from '../components/RegistrationWizard'
import { CheckCircle } from 'lucide-react'

export function Register() {
  const agents = useAgents()
  const enabledAgents = agents.data?.filter(a => a.enabled || a.slot <= 1) ?? []

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-medium text-gray-300 mb-2">Registration Guide</h2>
        <p className="text-sm text-gray-400">
          Each agent needs a Moltbook account. Registration uses your X (Twitter) account for
          verification. Complete the steps below for each agent you want to activate.
        </p>
      </div>

      {agents.isLoading ? (
        <div className="text-center py-8 text-gray-600">Loading agents…</div>
      ) : (
        enabledAgents.map(agent => (
          <div key={agent.slot} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center text-brand-300 text-sm font-bold">
                {agent.slot}
              </div>
              <h3 className="font-medium text-gray-200">{agent.persona.name}</h3>
              {agent.claimed && (
                <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle className="w-3.5 h-3.5" /> Claimed
                </span>
              )}
            </div>
            <RegistrationWizard agent={agent} />
          </div>
        ))
      )}
    </div>
  )
}
