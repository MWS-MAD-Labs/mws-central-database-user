import {
  BriefcaseBusiness,
  Building2,
  GraduationCap,
  Layers3,
  MapPinned,
  Puzzle,
  Shapes,
  Tags,
} from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import {
  applicationCategoriesApi,
  applicationScopesApi,
  buildingsApi,
  institutionsApi,
  jobLevelsApi,
  jobPositionsApi,
  majorsApi,
  pcActivitiesApi,
  unitsApi,
} from '../api/masterDataApi.js'
import { ChildrenAllowanceCard } from '../components/ChildrenAllowanceCard.jsx'
import { GoogleAccountsCard } from '../components/GoogleAccountsCard.jsx'
import { MasterResourcePanel } from '../components/MasterResourcePanel.jsx'
import { Tabs } from '../../../components/ui/Tabs.jsx'

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
    flags: [
      {
        field: 'is_teaching_position',
        checkboxLabel: 'Teaching position',
        checkboxDescription:
          'Use this for positions that are teaching roles (e.g. subject teachers).',
        badgeOn: 'Teaching',
        badgeOff: 'Non-teaching',
      },
    ],
    unitScope: true,
    positionCapacity: true,
    reassignmentPreview: {
      entityLabel: 'workforce member',
      columnLabel: 'Workforce Member',
      itemLabel: 'workforce members',
      idField: 'employee_id',
      nameField: 'full_name',
      secondaryField: 'employee_number',
      linkTo: (item) =>
        item.member_type === 'INTERN'
          ? `/interns/${item.employee_id}`
          : `/employees/${item.employee_id}`,
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
    flags: [
      {
        field: 'is_teaching_role',
        checkboxLabel: 'Teaching role',
        checkboxDescription:
          'Use this for job levels that should be treated as teaching staff.',
        badgeOn: 'Teaching',
        badgeOff: 'Non-teaching',
      },
    ],
    unitScope: true,
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
    description: 'Reusable Passion Connection activity names. Create PC Activity Rooms per unit/grade from Academic > PC Activity Rooms.',
    icon: Puzzle,
    api: pcActivitiesApi,
    itemLabel: 'PC activities',
  },
]

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

const scopeResource = {
  id: 'application-scopes',
  label: 'Scopes',
  singular: 'Scope',
  description: 'The product space an application belongs to, like Safespace. Applications pick one in their details.',
  icon: Shapes,
  api: applicationScopesApi,
  itemLabel: 'scopes',
}

const categoryResource = {
  id: 'application-categories',
  label: 'Categories',
  singular: 'Category',
  description: 'The kind of tool an application is, like Reporting. The Hub groups its cards by it.',
  icon: Tags,
  api: applicationCategoriesApi,
  itemLabel: 'categories',
}

// Master data about the work people do lives in one tab with its own sub tabs, so a new list goes there and the
// sidebar stays short. The old links (?tab=job-positions and so on) open the right sub tab.
const EMPLOYMENT_SECTIONS = [
  { id: 'units', label: 'Units' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'job-positions', label: 'Job Positions' },
  { id: 'job-levels', label: 'Job Levels' },
  { id: 'education', label: 'Education' },
  { id: 'children-allowance', label: 'Children Allowance' },
  { id: 'google-accounts', label: 'Google Accounts' },
]

function EmploymentTab({ section, onSection }) {
  const active = EMPLOYMENT_SECTIONS.some((item) => item.id === section) ? section : 'units'
  return (
    <div className="space-y-6">
      <Tabs label="Employment master data" tabs={EMPLOYMENT_SECTIONS} active={active} onChange={onSection} />
      {active === 'education' ? (
        <div className="space-y-6">
          <MasterResourcePanel resource={institutionResource} />
          <MasterResourcePanel resource={majorResource} />
        </div>
      ) : active === 'children-allowance' ? (
        <ChildrenAllowanceCard />
      ) : active === 'google-accounts' ? (
        <GoogleAccountsCard />
      ) : (
        <MasterResourcePanel resource={resources.find((resource) => resource.id === active)} />
      )}
    </div>
  )
}

export default function MasterData() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  // Employment is the first tab, so a bare /master-data opens it, and the old links (?tab=units and so on) open
  // their sub tab.
  const isPcActivities = rawTab === 'pc-activities'
  const section = rawTab === 'employment' ? searchParams.get('section') : rawTab
  const isScopesTab = rawTab === 'scopes'

  return (
    <div className="min-w-0">
      <PageHeader
        title="Master Data"
        description="Manage reusable data lists that are stored in the database and referenced across employee and admin workflows."
      />

      {!isPcActivities && !isScopesTab ? (
        <EmploymentTab
          section={section}
          onSection={(next) => setSearchParams({ tab: 'employment', section: next })}
        />
      ) : isScopesTab ? (
        <div className="space-y-6">
          <MasterResourcePanel resource={scopeResource} />
          <MasterResourcePanel resource={categoryResource} />
        </div>
      ) : (
        <MasterResourcePanel resource={resources.find((resource) => resource.id === 'pc-activities')} />
      )}
    </div>
  )
}
