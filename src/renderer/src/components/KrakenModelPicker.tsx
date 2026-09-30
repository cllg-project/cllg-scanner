import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentType, KrakenConfig } from '@shared/types'

interface KrakenModelPickerProps {
  value: KrakenConfig
  onChange: (config: KrakenConfig) => void
}

const activeStyle = { background: '#0369a1', color: '#fff', borderColor: '#0369a1' }

export default function KrakenModelPicker({ value, onChange }: KrakenModelPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const documentType = value.documentType ?? 'cllg'
  const regionsOn = !!value.regionModelPath

  const useBuiltin = async (): Promise<void> => {
    const paths = await window.api.getKrakenBuiltinPaths()
    onChange({
      ...value,
      segModelPath: paths.segModelPath,
      recModelPath: paths.recModelPath,
      builtinModels: true,
      regionModelPath: regionsOn ? paths.regionModelPaths[documentType] : '',
    })
  }

  const browse = async (kind: 'segmentation' | 'recognition' | 'region'): Promise<void> => {
    const picked = await window.api.selectKrakenModel(kind)
    if (!picked) return
    onChange({
      ...value,
      builtinModels: false,
      segModelPath: kind === 'segmentation' ? picked : value.segModelPath,
      recModelPath: kind === 'recognition' ? picked : value.recModelPath,
      regionModelPath: kind === 'region' ? picked : value.regionModelPath,
    })
  }

  // With built-in models the region model follows the document type.
  const setDocumentType = async (type: DocumentType): Promise<void> => {
    if (value.builtinModels && regionsOn) {
      const paths = await window.api.getKrakenBuiltinPaths()
      onChange({ ...value, documentType: type, regionModelPath: paths.regionModelPaths[type] })
    } else {
      onChange({ ...value, documentType: type })
    }
  }

  const toggleRegions = async (on: boolean): Promise<void> => {
    if (!on) {
      onChange({ ...value, regionModelPath: '' })
    } else if (value.builtinModels) {
      const paths = await window.api.getKrakenBuiltinPaths()
      onChange({ ...value, regionModelPath: paths.regionModelPaths[documentType] })
    } else {
      await browse('region')
    }
  }

  const modelRow = (label: string, path: string | undefined, kind: 'segmentation' | 'recognition' | 'region'): React.JSX.Element => (
    <div className="flex items-center gap-2">
      <span className="shrink-0" style={{ color: 'var(--mute)', minWidth: 130 }}>{label}</span>
      <span className="font-mono text-[11px] truncate" style={{ color: 'var(--mute)' }}>
        {path || t('krakenModel.notSet')}
      </span>
      <button type="button" className="btn btn-quiet text-[11px] shrink-0 ml-auto" style={{ padding: '2px 8px' }} onClick={() => browse(kind)}>
        {t('krakenModel.browse')}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-2 text-[11.5px]">
      <div className="flex items-center gap-1 shrink-0">
        <span className="shrink-0 mr-1" style={{ color: 'var(--mute)' }}>{t('krakenModel.documentType')}</span>
        {(['cllg', 'ladas'] as const).map((type) => (
          <button
            key={type}
            type="button"
            className="btn btn-quiet text-[11px] shrink-0"
            style={{ padding: '3px 10px', ...(documentType === type ? activeStyle : {}) }}
            title={t(`krakenModel.documentTypeHint.${type}`)}
            onClick={() => setDocumentType(type)}
          >
            {t(`krakenModel.documentTypes.${type}`)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="btn btn-quiet text-[11px] shrink-0"
          style={{ padding: '3px 10px', ...(value.builtinModels ? activeStyle : {}) }}
          onClick={useBuiltin}
        >
          {t('krakenModel.builtin')}
        </button>
        <button
          type="button"
          className="btn btn-quiet text-[11px] shrink-0"
          style={{ padding: '3px 10px', ...(!value.builtinModels ? activeStyle : {}) }}
          onClick={() => onChange({ ...value, builtinModels: false })}
        >
          {t('krakenModel.custom')}
        </button>
        <label className="flex items-center gap-1.5 ml-3 cursor-pointer" title={t('krakenModel.regionsHint')}>
          <input type="checkbox" checked={regionsOn} onChange={(e) => void toggleRegions(e.target.checked)} />
          {t('krakenModel.detectRegions')}
        </label>
      </div>

      {!value.builtinModels && (
        <div className="flex flex-col gap-1.5">
          {modelRow(t('krakenModel.segmentationModel'), value.segModelPath, 'segmentation')}
          {modelRow(t('krakenModel.recognitionModel'), value.recModelPath, 'recognition')}
          {regionsOn && modelRow(t('krakenModel.regionModel'), value.regionModelPath, 'region')}
        </div>
      )}
    </div>
  )
}
