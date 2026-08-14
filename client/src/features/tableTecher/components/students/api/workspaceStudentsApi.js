import { studentsApi } from '../../../../students/api/studentsApi.js'

// Server caps size at 100 (StudentValidation.SEARCH), so "load everything"
// means walking the pages ourselves. Workspace is a grid, not a paged list.
const PAGE_SIZE = 100
const CONCURRENCY = 4
// Safety valve so a bad filter can't fire hundreds of requests.
const MAX_PAGES = 50

export async function fetchAllStudents(params) {
  const first = await studentsApi.list({ ...params, page: 1, size: PAGE_SIZE })

  const totalPage = Math.max(first.paging?.total_page || 1, 1)
  const pageCount = Math.min(totalPage, MAX_PAGES)
  const data = [...(first.data || [])]

  for (let page = 2; page <= pageCount; page += CONCURRENCY) {
    const batch = []
    for (let offset = 0; offset < CONCURRENCY && page + offset <= pageCount; offset++) {
      batch.push(studentsApi.list({ ...params, page: page + offset, size: PAGE_SIZE }))
    }

    const responses = await Promise.all(batch)
    responses.forEach((response) => data.push(...(response.data || [])))
  }

  return {
    data,
    paging: first.paging,
    pages_fetched: pageCount,
    // true when MAX_PAGES cut the walk short, the UI warns about it
    truncated: totalPage > MAX_PAGES,
  }
}
