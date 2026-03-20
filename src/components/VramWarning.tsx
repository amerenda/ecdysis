import { Info, CheckCircle } from 'lucide-react'
import { useVramCheck } from '../hooks/useBackend'

interface Props {
  models: string[]
}

export function VramWarning({ models }: Props) {
  const { data, isLoading } = useVramCheck(models)

  if (!data || isLoading || models.length === 0) return null

  return (
    <div className={`rounded-xl p-4 border ${
      data.fits_simultaneously
        ? 'bg-green-950/30 border-green-800'
        : 'bg-gray-800/50 border-gray-700'
    }`}>
      <div className="flex items-start gap-3">
        {data.fits_simultaneously ? (
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
        ) : (
          <Info className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${data.fits_simultaneously ? 'text-green-300' : 'text-gray-300'}`}>
            {data.fits_simultaneously
              ? 'Models fit in GPU memory'
              : 'Models will share GPU time'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Total: <span className="text-gray-300">{data.total_vram_needed_gb} GB</span>
            {' · '}
            GPU: <span className="text-gray-300">{data.gpu_vram_gb} GB</span>
            {!data.fits_simultaneously && (
              <span className="text-gray-500"> — agents run at staggered times, no issue</span>
            )}
          </p>

          <div className="mt-2 space-y-1">
            {data.per_model.map(m => (
              <div key={m.model} className="flex items-center justify-between text-xs">
                <span className="text-gray-500 truncate">{m.model}</span>
                <span className="text-gray-400 ml-2 flex-shrink-0">{m.vram_gb} GB</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
