import React from 'react'
import { useTranslation } from 'react-i18next'
import type { KrakenConfig } from '@shared/types'

interface KrakenModelPickerProps {
  value: KrakenConfig
  onChange: (config: KrakenConfig) => void
}

export default function KrakenModelPicker({ value, onChange }: KrakenModelPickerProps): React.JSX.Element {
  const { t } = useTranslation()

  const useBuiltin = async (): Promise<void> => {
    const paths = await window.api.getKrakenBuiltinPaths()
    onChange({ segModelPath: paths.segModelPath, recModelPath: paths.recModelPath, builtinModels: true })
  }

  const browse = async (kind: 'segmentation' | 'recognition'): Promise<void> => {
    const picked = await window.api.selectKrakenModel(kind)
    if (!picked) return
    onChange({
      ...value,
      builtinModels: false,
      segModelPath: kind === 'segmentation' ? picked : value.segModelPath,
      recModelPath: kind === 'recognition' ? picked : value.recModelPath,
    })
  }

  return (
    <div className="flex flex-col gap-2 text-[11.5px]">
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="btn btn-quiet text-[11px] shrink-0"
          style={{ padding: '3px 10px', ...(value.builtinModels ? { background: '#0369a1', color: '#fff', borderColor: '#0369a1' } : {}) }}
          onClick={useBuiltin}
        >
          {t('krakenModel.builtin')}
        </button>
        <button
          type="button"
          className="btn btn-quiet text-[11px] shrink-0"
          style={{ padding: '3px 10px', ...(!value.builtinModels ? { background: '#0369a1', color: '#fff', borderColor: '#0369a1' } : {}) }}
          onClick={() => onChange({ ...value, builtinModels: false })}
        >
          {t('krakenModel.custom')}
        </button>
      </div>

      {!value.builtinModels && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="shrink-0" style={{ color: 'var(--mute)', minWidth: 130 }}>
              {t('krakenModel.segmentationModel')}
            </span>
            <span className="font-mono text-[11px] truncate" style={{ color: 'var(--mute)' }}>
              {value.segModelPath || t('krakenModel.notSet')}
            </span>
            <button type="button" className="btn btn-quiet text-[11px] shrink-0 ml-auto" style={{ padding: '2px 8px' }} onClick={() => browse('segmentation')}>
              {t('krakenModel.browse')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0" style={{ color: 'var(--mute)', minWidth: 130 }}>
              {t('krakenModel.recognitionModel')}
            </span>
            <span className="font-mono text-[11px] truncate" style={{ color: 'var(--mute)' }}>
              {value.recModelPath || t('krakenModel.notSet')}
            </span>
            <button type="button" className="btn btn-quiet text-[11px] shrink-0 ml-auto" style={{ padding: '2px 8px' }} onClick={() => browse('recognition')}>
              {t('krakenModel.browse')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
