export type MaybePromise<T> = T | Promise<T>;

/** 聊天消息角色。`system` 只用于兼容服务端历史消息，组件不主动生成。 */
export type ChatRole = "user" | "assistant" | "system";

/** ChatKit 内部使用的消息。流式回复没有稳定服务端 ID，因此使用字符串 ID。 */
export interface Message {
  id: string;
  role: ChatRole;
  content: string;
}

/** 聊天接口返回的历史消息结构。 */
export interface ServerMessage {
  id: number;
  role: ChatRole;
  content: string;
  created_at: string;
}

/** 聊天接口返回的会话结构。 */
export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

/**
 * ChatKit 访问后端的接口路径。
 *
 * 所有成员都可省略，省略时使用 `/conversations`、`/chat` 等默认路径。
 * 路径应相对于 `ChatKitConfig.baseUrl`，不需要以完整 URL 开头。
 */
export interface ChatKitApiPaths {
  /** 会话列表；同时用于创建会话的 POST 请求。 */
  conversations: string;
  /** 删除指定会话。 */
  conversation: (conversationId: number) => string;
  /** 查询指定会话的历史消息。 */
  conversationMessages: (conversationId: number) => string;
  /** 发送消息并返回 SSE 流。 */
  chat: string;
}

/**
 * 自定义 fetch 实现。宿主可以在测试中替换它，或在非浏览器环境中
 * 注入带超时、代理或重试能力的实现。
 */
export type ChatKitFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * ChatKit 连接宿主后端所需的配置。
 *
 * ChatKit 不读取浏览器存储、不刷新 token，也不实现登录注册。宿主通过
 * `getAccessToken()` 在每次请求前提供当时可用的访问令牌。
 */
export interface ChatKitConfig {
  /** 后端基础地址，例如 `https://chat-api.example.com`。 */
  baseUrl: string;
  /** 每次请求前调用；返回空字符串会触发 missing-access-token 错误。 */
  getAccessToken: () => MaybePromise<string>;
  /** 覆盖部分或全部默认接口路径。 */
  paths?: Partial<ChatKitApiPaths>;
  /** 自定义请求头；同名内置 JSON/Authorization 头优先生效。 */
  headers?:
    | Record<string, string>
    | (() => MaybePromise<Record<string, string> | undefined>);
  /** 透传给 fetch 的 credentials 配置。 */
  credentials?: RequestCredentials;
  /** 替换默认 fetch。未提供时使用全局 fetch。 */
  fetch?: ChatKitFetch;
  /** 收到 401 时回调；ChatKit 只报告状态，凭证处理由宿主决定。 */
  onUnauthorized?: (context: ChatKitUnauthorizedContext) => void;
  /** 收到请求、响应格式或流式解析错误时回调。 */
  onError?: (error: unknown) => void;
}

/** 401 回调上下文，`requestPath` 是相对于 baseUrl 的路径。 */
export interface ChatKitUnauthorizedContext {
  status: number;
  requestPath: string;
}

/** 单个会话在内存中的消息、输入框和请求状态。 */
export interface ConversationChatState {
  messages: Message[];
  isLoading: boolean;
  historyLoaded: boolean;
  historyLoading: boolean;
  historyError: string | null;
  draftInput: string;
  sendError: string | null;
}

/**
 * controller 当前对外暴露的完整状态。状态对象每次更新都会被替换，
 * 订阅者可以安全保留旧对象用于比较。
 */
export interface ChatKitState {
  identity: string | number;
  conversations: Conversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  isCreatingConversation: boolean;
  actionError: string | null;
  activeConversationId: number | null;
  draftInput: string;
  chats: Record<number, ConversationChatState>;
}
