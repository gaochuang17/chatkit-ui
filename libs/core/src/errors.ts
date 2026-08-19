export type ChatKitErrorCode =
  | "http"
  | "unauthorized"
  | "missing-access-token"
  | "invalid-response"
  | "sse"
  | "aborted"
  | "reset"
  | "unknown";

/** ChatKit 内部统一错误对象；`code` 可用于区分取消、401 和响应格式问题。 */
export class ChatKitError extends Error {
  readonly code: ChatKitErrorCode;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { code?: ChatKitErrorCode; status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ChatKitError";
    this.code = options.code ?? "unknown";
    this.status = options.status;
    this.cause = options.cause;
  }
}

/** 提取面向用户的错误消息；未知值或空消息时返回 fallback。 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
