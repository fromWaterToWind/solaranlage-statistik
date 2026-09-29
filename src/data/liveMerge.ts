import type { PlantProfile, SourceBinding } from '@/domain/plant'
import type { LiveSnapshot } from '@/domain/types'

/** When HA is off but Growatt token is set, treat Growatt as live source (not Shelly/EcoTracker HA slots). */
export function plantForNoHaMerge(plant: PlantProfile, growattTokenSet: boolean): PlantProfile {
  if (!growattTokenSet) return plant
  const via: SourceBinding = 'growattApi'
  return {
    ...plant,
    pv: plant.pv.adapter === 'growatt' ? { ...plant.pv, via } : plant.pv,
    storage:
      plant.storage?.adapter === 'growatt' ? { ...plant.storage, via } : plant.storage,
    inverterAc: { adapter: 'growatt', via },
    grid: { adapter: 'growatt', via },
  }
}

export function mergeLiveWithGrowatt(
  base: LiveSnapshot,
  growatt: LiveSnapshot,
  plant: PlantProfile,
): LiveSnapshot {
  const out: LiveSnapshot = {
    ...base,
    at: growatt.at || base.at,
  }

  if (plant.pv.adapter === 'growatt' && plant.pv.via === 'growattApi') {
    out.pvW = growatt.pvW
    out.pvFault = growatt.pvFault
    if (growatt.mppts.length) out.mppts = growatt.mppts
  }

  if (plant.storage?.adapter === 'growatt' && plant.storage.via === 'growattApi') {
    out.battery = { ...growatt.battery }
  }

  if (plant.inverterAc.adapter === 'growatt' && plant.inverterAc.via === 'growattApi') {
    out.outputW = growatt.outputW
  }

  if (plant.grid.adapter === 'growatt' && plant.grid.via === 'growattApi') {
    out.grid = growatt.grid
  } else if (plant.grid.via !== 'haEntity') {
    out.grid = growatt.grid
  }

  if (base.homeFault && !growatt.homeFault) {
    out.homeW = growatt.homeW
    out.homeFault = growatt.homeFault
  } else if (base.homeFault && growatt.homeW > 0) {
    out.homeW = growatt.homeW
    out.homeFault = null
  }

  return out
}
