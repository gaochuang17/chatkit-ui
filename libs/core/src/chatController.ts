import { createChatApiClient } from "./apiClient";
import { ChatKitError, getErrorMessage } from "./errors";
import { parseSSEData, readSSEStream } from "./sse";
import type {
  ChatKitConfig,
  ChatKitState,
  Conversation,
  ConversationChatState,
  Message,
} from "./types";

export interface ChatControllerOptions {
  /** 初始请求配置；后续可用 updateConfig() 替换。 */
  config: ChatKitConfig;
  /** 宿主内当前用户 ID。切换 identity 会清空内存中的会话状态。 */
  identity: string | number;
}

/**
 * 框架无关的会话状态控制器。
 *
 * controller 拥有会话列表、每个会话的消息缓存和进行中的请求；UI 层只订阅
 * 状态并调用方法。离开 UI 生命周期时必须调用 suspend() 或 destroy()，否则
 * 后台请求可能继续写入已经不再展示的状态。
 */
export interface ChatController {
  /** 返回当前状态对象；该对象在每次 setState 后都会被替换。 */
  getState(): ChatKitState;
  /** 订阅状态变化，返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
  /** 替换请求配置，不清除已经加载的会话和消息。 */
  updateConfig(config: ChatKitConfig): void;
  /** 加载会话列表；已有列表请求进行中时复用同一个 Promise。 */
  initialize(): Promise<void>;
  /** 取消所有请求并清空状态，但 controller 之后仍可 initialize()。 */
  suspend(): void;
  /** 切换用户并重新加载会话列表。 */
  reset(identity: string | number): Promise<void>;
  /** 强制刷新会话列表。 */
  listConversations(): Promise<void>;
  /** 创建后端会话，并把新会话插入列表头部。 */
  createConversation(): Promise<Conversation | void>;
  /** 选中会话并按需加载历史消息。 */
  selectConversation(conversationId: number): Promise<void>;
  /** 重试当前会话的历史消息加载。 */
  retryHistory(): Promise<void>;
  /** 发送当前草稿；没有会话时先创建会话，再打开 SSE 流。 */
  sendMessage(): Promise<void>;
  /** 中止指定会话或当前会话的流式请求。 */
  stop(targetConversationId?: number): void;
  /** 删除后端会话，并同步移除它的消息缓存和进行中请求。 */
  removeConversation(conversationId: number): Promise<void>;
  /** 回到新会话草稿页，此时消息发送后才真正调用创建接口。 */
  startDraftConversation(): void;
  /** 更新当前会话输入框草稿。 */
  setDraft(value: string): void;
  /** 永久销毁 controller，之后不能再订阅或发起新请求。 */
  destroy(): void;
}

function createConversationState(): ConversationChatState {
  return {
    messages: [],
    isLoading: false,
    historyLoaded: false,
    historyLoading: false,
    historyError: null,
    draftInput: "",
    sendError: null,
  };
}

function createState(identity: string | number): ChatKitState {
  return {
    identity,
    conversations: [],
    conversationsLoading: false,
    conversationsError: null,
    isCreatingConversation: false,
    actionError: null,
    activeConversationId: null,
    draftInput: "",
    chats: {},
  };
}

function createMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toClientMessage(message: {
  id: number;
  role: ConversationChatState["messages"][number]["role"];
  content: string;
}): Message {
  return {
    id: String(message.id),
    role: message.role,
    content: message.content,
  };
}

/**
 * 创建聊天状态控制器。调用方负责在卸载时执行 suspend() 或 destroy()；
 * 多个组件可以各自持有独立 controller，互不共享消息缓存。
 */
export function createChatController({
  config,
  identity,
}: ChatControllerOptions): ChatController {
  let currentConfig = config;
  let state = createState(identity);
  // generation 在清空、切换用户或销毁时递增，用于丢弃旧生命周期的迟到响应。
  let generation = 0;
  // listVersion 单调递增，防止较早的会话列表响应覆盖删除或新建结果。
  let listVersion = 0;
  let destroyed = false;
  // 并发调用时复用同一个 Promise，避免相同请求重复发出。
  let listPromise: Promise<void> | null = null;
  let createPromise: Promise<Conversation | void> | null = null;
  const listeners = new Set<() => void>();
  // 发送中的 SSE 请求按 conversationId 隔离，stop() 可以只停止当前会话。
  const abortControllers = new Map<number, AbortController>();
  // 普通请求和流式请求都登记在这里，suspend() 可统一取消。
  const requestControllers = new Set<AbortController>();
  const client = createChatApiClient({ getConfig: () => currentConfig });

  function setState(
    patch:
      Partial<ChatKitState> | ((state: ChatKitState) => Partial<ChatKitState>),
  ) {
    if (destroyed) return;
    const nextPatch = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...nextPatch };
    // 复制 listeners，避免监听器在通知过程中取消订阅导致集合被修改。
    for (const listener of [...listeners]) listener();
  }

  function updateConversation(
    conversationId: number,
    updater: (chat: ConversationChatState) => ConversationChatState,
  ): boolean {
    const chat = state.chats[conversationId];
    if (!chat) return false;

    setState((current) => ({
      chats: {
        ...current.chats,
        [conversationId]: updater(chat),
      },
    }));
    return true;
  }

  function reportError(error: unknown, fallback: string) {
    if (destroyed) return;
    currentConfig.onError?.(error);
    return getErrorMessage(error, fallback);
  }

  function abortAll() {
    for (const controller of abortControllers.values()) controller.abort();
    abortControllers.clear();
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
  }

  function createRequestController(): AbortController {
    const controller = new AbortController();
    requestControllers.add(controller);
    return controller;
  }

  function releaseRequestController(controller: AbortController) {
    requestControllers.delete(controller);
  }

  async function loadHistory(
    conversationId: number,
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (!state.chats[conversationId]) {
      setState((current) => ({
        chats: {
          ...current.chats,
          [conversationId]: createConversationState(),
        },
      }));
    }

    const chat = state.chats[conversationId];
    if (
      destroyed ||
      chat?.isLoading ||
      chat?.historyLoaded ||
      (chat?.historyLoading && !options.force)
    ) {
      return;
    }

    const requestGeneration = generation;
    const requestController = createRequestController();
    updateConversation(conversationId, (current) => ({
      ...current,
      historyLoading: true,
      historyError: null,
    }));

    try {
      const serverMessages = await client.listMessages(
        conversationId,
        requestController.signal,
      );
      if (requestGeneration !== generation) return;

      // 历史请求进行中时会话可能被删除；迟到响应不能把已删除的缓存重建出来。
      const latestChat = state.chats[conversationId];
      if (!latestChat || latestChat.historyLoaded) return;

      updateConversation(conversationId, (current) => ({
        ...current,
        messages: serverMessages.map(toClientMessage),
        historyLoaded: true,
        historyLoading: false,
        historyError: null,
      }));
    } catch (error) {
      if (requestGeneration !== generation) return;
      const latestChat = state.chats[conversationId];
      if (!latestChat || latestChat.historyLoaded) return;

      const message = reportError(error, "历史消息加载失败") as string;
      updateConversation(conversationId, (current) => ({
        ...current,
        historyLoading: false,
        historyError: message,
      }));
    } finally {
      releaseRequestController(requestController);
      if (requestGeneration === generation) {
        updateConversation(conversationId, (current) => ({
          ...current,
          historyLoading: false,
        }));
      }
    }
  }

  async function listConversations(): Promise<void> {
    if (destroyed || state.conversationsLoading)
      return listPromise ?? undefined;

    const requestGeneration = generation;
    const requestListVersion = ++listVersion;
    const requestController = createRequestController();
    setState({
      conversationsLoading: true,
      conversationsError: null,
    });

    let promise: Promise<void> | null = null;
    promise = (async (): Promise<void> => {
      try {
        const conversations = await client.listConversations(
          requestController.signal,
        );
        if (
          requestGeneration !== generation ||
          requestListVersion !== listVersion
        ) {
          return;
        }

        setState({ conversations });
        return;
      } catch (error) {
        if (
          requestGeneration === generation &&
          requestListVersion === listVersion
        ) {
          const message = reportError(error, "会话列表加载失败") as string;
          setState({ conversationsError: message });
        }
        return undefined;
      } finally {
        if (
          requestGeneration === generation &&
          requestListVersion === listVersion
        ) {
          setState({ conversationsLoading: false });
        }
        if (promise !== null && listPromise === promise) listPromise = null;
      }
    })();
    listPromise = promise;

    return listPromise;
  }

  async function createConversation(): Promise<Conversation | void> {
    if (destroyed || state.isCreatingConversation)
      return createPromise ?? undefined;

    const requestGeneration = generation;
    const requestController = createRequestController();
    setState({ isCreatingConversation: true, actionError: null });

    let promise: Promise<Conversation | void> | null = null;
    promise = (async (): Promise<Conversation | void> => {
      try {
        const conversation = await client.createConversation(
          requestController.signal,
        );
        if (requestGeneration !== generation) return undefined;

        // 新会话已经本地插入，较旧的列表响应晚返回时不能覆盖它。
        listVersion += 1;
        setState((current) => ({
          conversations: [conversation, ...current.conversations],
        }));
        return conversation;
      } catch (error) {
        if (requestGeneration === generation) {
          const message = reportError(error, "创建对话失败") as string;
          setState({ actionError: message });
        }
        return undefined;
      } finally {
        if (requestGeneration === generation) {
          setState({ isCreatingConversation: false });
        }
        if (promise !== null && createPromise === promise) createPromise = null;
      }
    })();
    createPromise = promise;

    return createPromise;
  }

  async function sendMessage(): Promise<void> {
    if (destroyed) return;

    let conversationId = state.activeConversationId;
    let isNewConversation = conversationId === null;
    let text: string;

    if (isNewConversation) {
      text = state.draftInput.trim();
      if (!text || state.isCreatingConversation) return;

      const conversation = await createConversation();
      if (!conversation) return;
      const createdConversationId = conversation.id;
      conversationId = createdConversationId;

      // 数据重置后后端可能复用数字 ID；采用新会话前先丢弃旧 ID 的流状态。
      abortControllers.get(createdConversationId)?.abort();
      abortControllers.delete(createdConversationId);
      setState((current) => ({
        activeConversationId: createdConversationId,
        draftInput: "",
        chats: {
          ...current.chats,
          [createdConversationId]: {
            ...createConversationState(),
            historyLoaded: true,
          },
        },
      }));
    } else if (conversationId === null) {
      return;
    } else {
      const chat = state.chats[conversationId];
      text = chat?.draftInput.trim() ?? "";
      if (
        !text ||
        chat?.isLoading ||
        chat?.historyLoading ||
        chat?.historyError
      ) {
        return;
      }
    }

    const requestConversationId = conversationId;
    if (requestConversationId === null) return;
    const requestGeneration = generation;
    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: text,
    };
    const assistantMessage: Message = {
      id: createMessageId(),
      role: "assistant",
      content: "",
    };

    if (
      !updateConversation(requestConversationId, (current) => ({
        ...current,
        messages: [...current.messages, userMessage, assistantMessage],
        isLoading: true,
        historyLoaded: true,
        historyLoading: false,
        historyError: null,
        draftInput: "",
        sendError: null,
      }))
    ) {
      return;
    }

    const controller = new AbortController();
    abortControllers.set(requestConversationId, controller);
    requestControllers.add(controller);
    // 会话删除、用户切换、stop() 或同 ID 新会话都会让这条流失效。
    const canWrite = () =>
      requestGeneration === generation &&
      !controller.signal.aborted &&
      abortControllers.get(requestConversationId) === controller &&
      Boolean(state.chats[requestConversationId]);

    let completed = false;
    try {
      const response = await client.openChatStream(
        requestConversationId,
        text,
        controller.signal,
      );
      await readSSEStream(response, (data) => {
        if (!canWrite())
          throw new ChatKitError("请求已失效", { code: "reset" });

        const event = parseSSEData(data);
        if (event.type === "done") {
          completed = true;
          return false;
        }
        if (event.type === "error") {
          throw new ChatKitError(event.error ?? "流式响应返回错误", {
            code: "sse",
          });
        }
        if (event.type === "ignored") {
          throw new ChatKitError(`无法解析的 SSE 数据: ${event.data ?? ""}`, {
            code: "sse",
          });
        }
        if (event.content) {
          updateConversation(requestConversationId, (current) => ({
            ...current,
            messages: current.messages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + event.content }
                : message,
            ),
          }));
        }
      });
    } catch (error) {
      if (!canWrite()) return;
      if (error instanceof ChatKitError && error.code === "aborted") return;

      const message = reportError(error, "消息发送失败") as string;
      updateConversation(requestConversationId, (current) => ({
        ...current,
        sendError: message,
      }));
    } finally {
      const isCurrentRequest =
        abortControllers.get(requestConversationId) === controller;
      if (isCurrentRequest) abortControllers.delete(requestConversationId);
      releaseRequestController(controller);

      if (requestGeneration === generation && isCurrentRequest) {
        updateConversation(requestConversationId, (current) => ({
          ...current,
          isLoading: false,
          historyLoaded: true,
        }));
      }
    }

    // 后端可能根据首条消息更新标题；流结束后刷新列表，同时不阻塞流式渲染。
    if (completed && requestGeneration === generation) {
      await listConversations();
    }
  }

  async function removeConversation(conversationId: number): Promise<void> {
    if (destroyed) return;

    const requestGeneration = generation;
    const requestController = createRequestController();
    setState({ actionError: null });

    try {
      await client.deleteConversation(conversationId, requestController.signal);
      if (requestGeneration !== generation) return;

      listVersion += 1;
      abortControllers.get(conversationId)?.abort();
      abortControllers.delete(conversationId);

      setState((current) => {
        const chats = { ...current.chats };
        delete chats[conversationId];
        return {
          conversations: current.conversations.filter(
            (conversation) => conversation.id !== conversationId,
          ),
          activeConversationId:
            current.activeConversationId === conversationId
              ? null
              : current.activeConversationId,
          chats,
        };
      });
    } catch (error) {
      if (requestGeneration === generation) {
        const message = reportError(error, "删除对话失败") as string;
        setState({ actionError: message });
      }
    } finally {
      releaseRequestController(requestController);
    }
  }

  function destroy() {
    if (destroyed) return;
    generation += 1;
    abortAll();
    destroyed = true;
    listeners.clear();
  }

  function suspend() {
    if (destroyed) return;
    generation += 1;
    abortAll();
    state = createState(state.identity);
    for (const listener of [...listeners]) listener();
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateConfig(nextConfig) {
      // React 层只在 identity、baseUrl 或 paths 变化时重建 controller；
      // 回调配置更新只作用于下一次请求，不清空已缓存消息。
      currentConfig = nextConfig;
    },
    async initialize() {
      // React Strict Mode 会先 cleanup 再 setup。suspend() 会中断旧请求，
      // setup 重新加载；若同一生命周期内已有列表请求，则复用该请求。
      if (destroyed || state.conversationsLoading) return;
      return listConversations();
    },
    suspend,
    async reset(nextIdentity) {
      generation += 1;
      abortAll();
      state = createState(nextIdentity);
      for (const listener of [...listeners]) listener();
      return listConversations();
    },
    listConversations,
    createConversation,
    async selectConversation(conversationId) {
      setState({ activeConversationId: conversationId });
      await loadHistory(conversationId);
    },
    retryHistory() {
      const conversationId = state.activeConversationId;
      if (conversationId === null) return Promise.resolve();
      return loadHistory(conversationId, { force: true });
    },
    sendMessage,
    stop(targetConversationId) {
      const conversationId = targetConversationId ?? state.activeConversationId;
      if (conversationId === null) return;

      abortControllers.get(conversationId)?.abort();
      updateConversation(conversationId, (current) => ({
        ...current,
        isLoading: false,
        sendError: null,
      }));
    },
    removeConversation,
    startDraftConversation() {
      setState({ activeConversationId: null });
    },
    setDraft(value) {
      const conversationId = state.activeConversationId;
      if (conversationId === null) {
        setState({ draftInput: value });
        return;
      }
      updateConversation(conversationId, (current) => ({
        ...current,
        draftInput: value,
      }));
    },
    destroy,
  };
}
