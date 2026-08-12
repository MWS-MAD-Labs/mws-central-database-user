import {
  BriefcaseBusiness,
  Building2,
  Layers3,
  MapPinned,
  Puzzle,
} from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import {
  buildingsApi,
  jobLevelsApi,
  jobPositionsApi,
  pcActivitiesApi,
  unitsApi,
} from '../api/masterDataApi.js'
import { MasterResourcePanel } from '../components/MasterResourcePanel.jsx'

const resources = [
  {
    id: 'units',
    label: 'Units',
    singular: 'Unit',
    description: 'School branches and organization units used by employees and admin access scope.',
    icon: Building2,
    api: unitsApi,
    itemLabel: 'units',
  },
  {
    id: 'job-positions',
    label: 'Job Positions',
    singular: 'Job Position',
    description: 'Position names used in employee records, reporting, and internal directories.',
    icon: BriefcaseBusiness,
    api: jobPositionsApi,
    itemLabel: 'positions',
    teachingFlag: {
      field: 'is_teaching_position',
      checkboxLabel: 'Teaching position',
      checkboxDescription:
        'Use this for positions that are teaching roles (e.g. subject teachers).',
    },
  },
  {
    id: 'job-levels',
    label: 'Job Levels',
    singular: 'Job Level',
    description: 'Employment levels, including whether a level counts as a teaching role.',
    icon: Layers3,
    api: jobLevelsApi,
    itemLabel: 'levels',
    teachingFlag: {
      field: 'is_teaching_role',
      checkboxLabel: 'Teaching role',
      checkboxDescription:
        'Use this for job levels that should be treated as teaching staff.',
    },
  },
  {
    id: 'buildings',
    label: 'Buildings',
    singular: 'Building',
    description: 'Reusable building names used by employee records and import validation.',
    icon: MapPinned,
    api: buildingsApi,
    itemLabel: 'buildings',
  },
  {
    id: 'pc-activities',
    label: 'PC Activities',
    singular: 'PC Activity',
    description: 'Reusable Passion Connection activity names, selectable when registering a student.',
    icon: Puzzle,
    api: pcActivitiesApi,
    itemLabel: 'PC activities',
  },
]

export default function MasterData() {
  const [searchParams] = useSearchParams()
  const activeResource =
    resources.find((resource) => resource.id === searchParams.get('tab')) ||
    resources[0]

  return (
    <div className="min-w-0">
      <PageHeader
        title="Master Data"
        description="Manage reusable data lists that are stored in the database and referenced across employee and admin workflows."
      />

      <MasterResourcePanel resource={activeResource} />
    </div>
  )
}
