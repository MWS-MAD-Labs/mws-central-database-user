import { masterDataApi } from '../../master-data/api/masterDataApi.js'
import { fetchAllPages } from '../../../lib/pagination.js'

export async function loadEmployeeFormOptions() {
  const [units, jobPositions, jobLevels, buildings] = await Promise.all([
    fetchAllPages(masterDataApi.units),
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
