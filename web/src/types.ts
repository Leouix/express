export interface PaginatedResponse<T = number> {
  data: T[];
  hasMore: boolean;
  page: number;
  limit: number;
}

export interface AddBatchResult {
  added: number[];
  duplicates: number[];
}

export interface AddBatchResponse {
  success: boolean;
  added: number[];
  duplicates: number[];
}

export type UpdateAction =
  | { type: 'SELECT'; id: number }
  | { type: 'UNSELECT'; id: number }
  | { type: 'MOVE'; id: number; beforeId: number | null };