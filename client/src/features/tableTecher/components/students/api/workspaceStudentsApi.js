import { studentsApi } from '../../../../students/api/studentsApi.js'
import { fetchAllPages } from '../../../../../lib/pagination.js'

export const fetchAllStudents = (params) => fetchAllPages(studentsApi.list, params)
