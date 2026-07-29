import { masterDataApi } from '../../master-data/api/masterDataApi.js'

export async function loadEmployeeFormOptions() {
  const [units, jobPositions, jobLevels, buildings] = await Promise.all([
    masterDataApi.units(),
    masterDataApi.jobPositions(),
    masterDataApi.jobLevels(),
    masterDataApi.buildings(),
  ])

  return {
    units: units.data || [],
    jobPositions: jobPositions.data || [],
    jobLevels: jobLevels.data || [],
    buildings: buildings.data || [],
  }
}
