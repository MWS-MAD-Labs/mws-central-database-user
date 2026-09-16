const DEFAULT_PAGE_SIZE = 100
const DEFAULT_CONCURRENCY = 4
// Safety valve so a bad filter can't fire hundreds of requests.
const DEFAULT_MAX_PAGES = 50

// Server caps size at 100 on every SEARCH schema, so "give me everything for
// this picker/dropdown" means walking every page ourselves - a plain
// page:1/size:100 call silently drops anything past the first 100 rows.
// listFn is a bare async (params) => { data, paging } function, e.g.
// employeesApi.list or studentsApi.list.
export async function fetchAllPages(listFn, params = {}, {
  pageSize = DEFAULT_PAGE_SIZE,
  concurrency = DEFAULT_CONCURRENCY,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const first = await listFn({ ...params, page: 1, size: pageSize })

  const totalPage = Math.max(first.paging?.total_page || 1, 1)
  const pageCount = Math.min(totalPage, maxPages)
  const data = [...(first.data || [])]

  for (let page = 2; page <= pageCount; page += concurrency) {
    const batch = []
    for (let offset = 0; offset < concurrency && page + offset <= pageCount; offset++) {
      batch.push(listFn({ ...params, page: page + offset, size: pageSize }))
    }

    const responses = await Promise.all(batch)
    responses.forEach((response) => data.push(...(response.data || [])))
  }

  return {
    data,
    paging: first.paging,
    pages_fetched: pageCount,
    // true when maxPages cut the walk short - the caller can warn about it.
    truncated: totalPage > maxPages,
  }
}
