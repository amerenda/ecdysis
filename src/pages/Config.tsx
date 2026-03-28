import { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { useCommonConfig, useUpdateCommonConfig } from '../hooks/useBackend'

export function Config() {
  const config = useCommonConfig()
  const update = useUpdateCommonConfig()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config.data) setValue(config.data.common_md)
  }, [config.data])

  async function handleSave() {
    await update.mutateAsync(value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Global Config</h2>
        <p className="text-sm text-gray-500 mt-1">
          Settings that apply to all agents.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div>
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">COMMON.md</span>
            <span className="text-xs text-gray-600">Injected into every LLM call for all agents</span>
          </label>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={12}
            placeholder="Instructions that apply to all agents. For example:&#10;- Never use markdown formatting in posts&#10;- Always use plain text&#10;- Keep posts under 200 characters"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm font-mono focus:outline-none focus:border-brand-500 resize-y"
          />
          <p className="text-xs text-gray-600 mt-1">
            {value.length} chars — prepended to the system prompt before persona, soul, and rules
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
          {saved && <span className="text-xs text-green-400">Saved</span>}
        </div>
      </div>
    </div>
  )
}
