export type BulkIdsRequest = {
  ids: string[];
};

export type BulkActionItemResponse<T = unknown> = {
  id: string;
  status: "SUCCESS" | "FAILED";
  data?: T;
  error?: string;
};

export type BulkActionResponse<T = unknown> = {
  total_count: number;
  success_count: number;
  failed_count: number;
  items: BulkActionItemResponse<T>[];
};

export function toBulkActionResponse<T>(
  items: BulkActionItemResponse<T>[],
): BulkActionResponse<T> {
  const successCount = items.filter((item) => item.status === "SUCCESS").length;

  return {
    total_count: items.length,
    success_count: successCount,
    failed_count: items.length - successCount,
    items,
  };
}
