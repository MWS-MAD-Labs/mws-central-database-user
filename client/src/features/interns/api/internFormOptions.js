import { masterDataApi } from '../../master-data/api/masterDataApi.js'

export async function loadInternFormOptions() {
  const [units, jobPositions, buildings] = await Promise.all([
    masterDataApi.units(),
    masterDataApi.jobPositions(),
    masterDataApi.buildings(),
  ])

  return {
    units: units.data || [],
    jobPositions: jobPositions.data || [],
    buildings: buildings.data || [],
  }
}
