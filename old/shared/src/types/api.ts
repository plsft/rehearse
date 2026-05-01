export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

export interface PaginatedResponse<T> {
  ok: true;
  data: T[];
  pagination: { total: number; page: number; pageSize: number; hasMore: boolean };
}
