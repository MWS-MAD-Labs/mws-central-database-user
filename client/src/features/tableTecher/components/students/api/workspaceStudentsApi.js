import { studentsApi } from '../../../../students/api/studentsApi.js'
import { fetchAllPages } from '../../../../../lib/pagination.js'

// Workspace is a grid, not a paged list, so it needs every student up
// front - see lib/pagination.js for why a plain page:1/size:100 call isn't
// enough.
export const fetchAllStudents = (params) => fetchAllPages(studentsApi.list, params)
