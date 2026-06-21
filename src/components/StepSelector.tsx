import { useState } from 'react'
import type { AppData, PipelineItem, Step } from '../types'

interface Props {
  item: PipelineItem
  saveData: (updater: (prev: AppData) => AppData) => void
  toast: { show: (msg: string, duration?: number) => void }
}

const STEPS: Step[] = ['S1', 'S2', 'S3', 'S4', 'S5']

export function StepSelector({ item, saveData, toast }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  function handleSelect(newStep: Step) {
    if (newStep === item.currentStep) { setIsOpen(false); return }
    const prev = item.currentStep
    saveData(d => ({
      ...d,
      pipeline: d.pipeline.map(p =>
        p.id === item.id ? { ...p, currentStep: newStep } : p
      ),
    }))
    toast.show(`ステップを ${prev} → ${newStep} に変更しました`)
    setIsOpen(false)
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setIsOpen(prev => !prev) }}
        className="text-xs font-bold text-indigo-600 shrink-0 hover:text-indigo-800 flex items-center gap-0.5"
        title="クリックでステップ変更"
      >
        {item.currentStep}<span className="text-[10px] text-indigo-400">▾</span>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[70px]">
            {STEPS.map(step => (
              <button
                key={step}
                onClick={() => handleSelect(step)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 transition-colors ${step === item.currentStep ? 'text-indigo-600 font-bold' : 'text-gray-700'}`}
              >
                {step}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
