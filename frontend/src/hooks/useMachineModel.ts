import { useEffect, useState } from 'react'
import type { MachineModel } from '@/types/settings.types'
import { readStoredMachineModel, loadMachineModelFromApi } from '@/lib/machineModelStorage'

export const MODEL_IMAGE: Record<MachineModel, string> = {
  'STCS-CS19': '/STCS-CS19.png',
  'STCS-evo500': '/STCS-evo500.png',
}

export function useMachineModel(): { model: MachineModel | null; imageSrc: string | null } {
  const [model, setModel] = useState<MachineModel | null>(readStoredMachineModel)

  useEffect(() => {
    void loadMachineModelFromApi().then(m => { if (m) setModel(m) })

    const onChanged = (e: Event) => {
      const m = (e as CustomEvent<MachineModel>).detail
      setModel(m)
    }
    window.addEventListener('machineModelChanged', onChanged)
    return () => window.removeEventListener('machineModelChanged', onChanged)
  }, [])

  return {
    model,
    imageSrc: model ? (MODEL_IMAGE[model] ?? null) : null,
  }
}
