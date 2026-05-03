export interface HttpError extends Error {
  statusCode?: number;
  provider?: string;
}
