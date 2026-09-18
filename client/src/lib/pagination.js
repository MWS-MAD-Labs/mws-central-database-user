const DEFAULT_PAGE_SIZE = 100
const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_PAGES = 50

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
    truncated: totalPage > maxPages,
  }
}
