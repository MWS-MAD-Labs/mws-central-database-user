import {
  BriefcaseBusiness,
  Building2,
  GraduationCap,
  Layers3,
  MapPinned,
  Puzzle,
} from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import {
  buildingsApi,
  institutionsApi,
  jobLevelsApi,
  jobPositionsApi,
  majorsApi,
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
    mentorField: {
      field: 'default_mentor_id',
      label: 'Default Mentor',
      description:
        'Pre-fills the mentor when this activity is assigned to a student - still changeable per student.',
    },
  },
]

// Institutions and Majors share one "Education" tab instead of two separate
// entries - both are small, closely related lists (both only ever feed
// suggestions on an employee's education fields), and giving each its own
// top-level tab made the sidebar feel cluttered.
const institutionResource = {
  id: 'institutions',
  label: 'Institutions',
  singular: 'Institution',
  description: 'Canonical education institution names, suggested when filling in an employee\'s education history.',
  icon: GraduationCap,
  api: institutionsApi,
  itemLabel: 'institutions',
}

const majorResource = {
  id: 'majors',
  label: 'Majors',
  singular: 'Major',
  description: 'Canonical major/field-of-study names, suggested when filling in an employee\'s education history.',
  icon: GraduationCap,
  api: majorsApi,
  itemLabel: 'majors',
}

export default function MasterData() {
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  const isEducationTab = tab === 'education'
  const activeResource = isEducationTab
    ? null
    : resources.find((resource) => resource.id === tab) || resources[0]

  return (
    <div className="min-w-0">
      <PageHeader
        title="Master Data"
        description="Manage reusable data lists that are stored in the database and referenced across employee and admin workflows."
      />

      {isEducationTab ? (
        <div className="space-y-6">
          <MasterResourcePanel resource={institutionResource} />
          <MasterResourcePanel resource={majorResource} />
        </div>
      ) : (
        <MasterResourcePanel resource={activeResource} />
      )}
    </div>
  )
}
