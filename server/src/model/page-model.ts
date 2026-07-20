export type Paging = {
  size: number;
  current_page: number;
  total_page: number;
  total_item: number;
};

export type Pageable<T> = {
  data: Array<T>;
  paging: Paging;
};

export async function paginate<T>(
  page: number,
  size: number,
  fetch: {
    count: () => Promise<number>;
    findMany: () => Promise<T[]>;
  },
): Promise<Pageable<T>> {
  const [totalItem, data] = await Promise.all([
    fetch.count(),
    fetch.findMany(),
  ]);

  return {
    data,
    paging: {
      size,
      current_page: page,
      total_page: Math.ceil(totalItem / size),
      total_item: totalItem,
    },
  };
}
