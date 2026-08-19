import { ChatKitError, getErrorMessage } from "./errors";
import type {
  ChatKitConfig,
  ChatKitFetch,
  ChatKitUnauthorizedContext,
  Conversation,
  ServerMessage,
} from "./types";

const defaultPaths = {
  conversations: "/conversations",
  conversation: (id: number) => `/conversations/${id}`,
  conversationMessages: (id: number) => `/conversations/${id}/messages`,
  chat: "/chat",
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string" && body.detail) return body.detail;
    if (body?.detail) return JSON.stringify(body.detail);
    if (body?.message) return String(body.message);
    return JSON.stringify(body);
  } catch {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}

export interface ChatApiClientOptions {
  /** 请求发起时读取最新配置；路径、token 和回调都能在运行中变化。 */
  getConfig: () => ChatKitConfig;
}

/**
 * 创建聊天 API 客户端。该函数只负责 HTTP 细节，不保存会话状态；
 * 取消请求通过调用方传入的 AbortSignal 完成。
 */
export function createChatApiClient({ getConfig }: ChatApiClientOptions) {
  // 每次请求重新解析路径，updateConfig() 修改接口路由时不需要重建 client。
  const resolvePaths = () => ({ ...defaultPaths, ...getConfig().paths });

  const path = {
    conversations: () => resolvePaths().conversations,
    conversation: (id: number) => resolvePaths().conversation(id),
    conversationMessages: (id: number) =>
      resolvePaths().conversationMessages(id),
    chat: () => resolvePaths().chat,
  };

  async function buildHeaders(): Promise<HeadersInit> {
    const config = getConfig();
    // token 在每次请求前重新获取，宿主可以在请求间隙完成刷新。
    const token = await config.getAccessToken();

    if (typeof token !== "string" || !token.trim()) {
      const error = new ChatKitError(
        "getAccessToken() did not return a non-empty access token",
        { code: "missing-access-token" },
      );
      config.onError?.(error);
      throw error;
    }

    const customHeaders =
      typeof config.headers === "function"
        ? ((await config.headers()) ?? {})
        : (config.headers ?? {});
    return {
      ...(customHeaders as Record<string, string>),
      // JSON API 请求统一带 Content-Type；流式接口同样使用 JSON 请求体。
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function fetchOrThrow(
    requestPath: string,
    init: RequestInit,
  ): Promise<Response> {
    const config = getConfig();
    const fetchImpl: ChatKitFetch = config.fetch ?? fetch;
    let response: Response;

    try {
      response = await fetchImpl(joinUrl(config.baseUrl, requestPath), init);
    } catch (error) {
      const chatError = new ChatKitError(
        getErrorMessage(error, "网络请求失败"),
        {
          code:
            error instanceof Error && error.name === "AbortError"
              ? "aborted"
              : "unknown",
          cause: error,
        },
      );
      config.onError?.(chatError);
      throw chatError;
    }

    if (response.status === 401) {
      // 这里只通知宿主凭证已失效；不抛错，让 assertOk 统一生成错误状态。
      const context: ChatKitUnauthorizedContext = {
        status: response.status,
        requestPath,
      };
      config.onUnauthorized?.(context);
    }

    return response;
  }

  async function assertOk(response: Response) {
    if (response.ok) return;

    const detail = await readErrorDetail(response);
    const error = new ChatKitError(detail || `HTTP ${response.status}`, {
      code: response.status === 401 ? "unauthorized" : "http",
      status: response.status,
    });

    if (response.status !== 401) {
      // 401 已由 onUnauthorized 表达，避免同一凭证问题触发两次宿主回调。
      getConfig().onError?.(error);
    }
    throw error;
  }

  async function requestJson<T>(
    method: string,
    requestPath: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = await buildHeaders();
    const response = await fetchOrThrow(requestPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: getConfig().credentials,
      signal,
    });
    await assertOk(response);

    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (error) {
      const chatError = new ChatKitError("接口返回了无效的 JSON", {
        code: "invalid-response",
        status: response.status,
        cause: error,
      });
      getConfig().onError?.(chatError);
      throw chatError;
    }
  }

  return {
    async listConversations(signal?: AbortSignal) {
      return requestJson<Conversation[]>(
        "GET",
        path.conversations(),
        undefined,
        signal,
      );
    },
    async createConversation(signal?: AbortSignal) {
      return requestJson<Conversation>(
        "POST",
        path.conversations(),
        {},
        signal,
      );
    },
    async listMessages(conversationId: number, signal?: AbortSignal) {
      return requestJson<ServerMessage[]>(
        "GET",
        path.conversationMessages(conversationId),
        undefined,
        signal,
      );
    },
    async deleteConversation(conversationId: number, signal?: AbortSignal) {
      await requestJson<void>(
        "DELETE",
        path.conversation(conversationId),
        undefined,
        signal,
      );
    },
    async openChatStream(
      conversationId: number,
      message: string,
      signal: AbortSignal,
    ): Promise<Response> {
      const headers = await buildHeaders();
      const response = await fetchOrThrow(path.chat(), {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation_id: conversationId, message }),
        credentials: getConfig().credentials,
        signal,
      });
      await assertOk(response);
      return response;
    },
  };
}
