import { ReloadOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, ConfigProvider, Input, Spin } from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  createChatController,
  type ChatKitConfig,
} from "@chatkit-lab/chatkit-core";
import ChatMessageList from "./components/ChatMessageList";
import ChatSidebar from "./components/ChatSidebar";
import styles from "./ChatKit.module.css";
import "./tokens.css";

export interface ChatKitTheme {
  /** AntD 主色，同时用于发送按钮等主要操作。 */
  colorPrimary?: string;
  /** 组件内部控件的基础圆角。 */
  borderRadius?: number;
  /** 覆盖组件文本和 AntD 控件的字体。 */
  fontFamily?: string;
}

/** `<ChatKit />` 的公开 props。 */
export interface ChatKitProps {
  /** 后端连接配置；ChatKit 不负责登录、注册或 token 刷新。 */
  config: ChatKitConfig;
  /** 宿主当前用户 ID；变化时清空会话缓存并重新加载。 */
  identity: string | number;
  /** 可选主题配置。 */
  theme?: ChatKitTheme;
  /** 追加到 `.chatkit-root` 的类名。 */
  className?: string;
  /** 应用在根元素上的内联样式。 */
  style?: CSSProperties;
}

/**
 * 生成 controller 重建 key。函数路径用 id=1 抽样提取字符串形态，
 * 避免宿主每次 render 创建新函数导致缓存被意外清空。
 */
function getControllerResetKey(
  config: ChatKitConfig,
  identity: string | number,
) {
  const paths = config.paths;
  const conversationPath = paths?.conversation?.(1) ?? "/conversations/1";
  const messagesPath =
    paths?.conversationMessages?.(1) ?? "/conversations/1/messages";

  return [
    identity,
    config.baseUrl,
    paths?.conversations ?? "/conversations",
    conversationPath,
    messagesPath,
    paths?.chat ?? "/chat",
  ].join("\u0000");
}

export default function ChatKit({
  config,
  identity,
  theme,
  className,
  style,
}: ChatKitProps) {
  const resetKey = getControllerResetKey(config, identity);
  const [controller, setController] = useState(() =>
    createChatController({ config, identity }),
  );
  const controllerKeyRef = useRef(resetKey);

  // 回调配置可能在宿主每次 render 时变化，只更新请求配置；
  // 端点或 identity 变化才重建 controller 并清空消息缓存。
  useEffect(() => {
    if (controllerKeyRef.current === resetKey) return;

    controllerKeyRef.current = resetKey;
    setController(createChatController({ config, identity }));
  }, [config, identity, resetKey]);

  useEffect(() => {
    controller.updateConfig(config);
  }, [controller, config]);

  useEffect(() => {
    // controller 是外部 store：挂载时加载会话，卸载时中断请求并清空状态。
    void controller.initialize();
    return () => controller.suspend();
  }, [controller]);

  // getServerSnapshot 复用 getState，让 SSR 和客户端首次渲染看到同一个空状态。
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const activeChat =
    state.activeConversationId === null
      ? undefined
      : state.chats[state.activeConversationId];
  const input =
    state.activeConversationId === null
      ? state.draftInput
      : activeChat?.draftInput;
  const isSending = activeChat?.isLoading ?? false;
  const historyBlocked = Boolean(
    activeChat?.historyLoading || activeChat?.historyError,
  );
  const canSend =
    Boolean(input?.trim()) &&
    !isSending &&
    !historyBlocked &&
    !state.isCreatingConversation;

  const send = useCallback(() => {
    void controller.sendMessage();
  }, [controller]);

  return (
    <ConfigProvider
      prefixCls="chatkit-ant"
      theme={{
        token: {
          colorPrimary: theme?.colorPrimary ?? "#10a37f",
          borderRadius: theme?.borderRadius ?? 8,
          fontFamily: theme?.fontFamily,
        },
      }}
    >
      <div
        className={[styles.root, "chatkit-root", className]
          .filter(Boolean)
          .join(" ")}
        style={{
          ...style,
          fontFamily: theme?.fontFamily,
        }}
      >
        <ChatSidebar
          conversations={state.conversations}
          activeConversationId={state.activeConversationId}
          loading={state.conversationsLoading}
          onSelect={controller.selectConversation}
          onNew={controller.startDraftConversation}
          onDelete={controller.removeConversation}
        />

        <main className={styles.main}>
          {state.conversationsError ? (
            <Alert
              className={styles.banner}
              type="error"
              showIcon
              message="会话列表加载失败"
              description={state.conversationsError}
              action={
                <Button
                  size="small"
                  onClick={() => void controller.listConversations()}
                >
                  重试
                </Button>
              }
            />
          ) : null}

          {state.actionError ? (
            <Alert
              className={styles.banner}
              type="error"
              showIcon
              message="操作失败"
              description={state.actionError}
            />
          ) : null}

          {activeChat?.historyError ? (
            <Alert
              className={styles.banner}
              type="error"
              showIcon
              message="历史消息加载失败"
              description={activeChat.historyError}
              action={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void controller.retryHistory()}
                >
                  重试
                </Button>
              }
            />
          ) : null}

          {activeChat?.sendError ? (
            <Alert
              className={styles.banner}
              type="error"
              showIcon
              message="消息发送失败"
              description={activeChat.sendError}
            />
          ) : null}

          <ChatMessageList
            messages={activeChat?.messages ?? []}
            isLoading={isSending}
            emptyVisible={!state.conversationsLoading}
          />

          <div className={styles.inputArea}>
            <div className={styles.inputWrapper}>
              <Input.TextArea
                className={styles.input}
                value={input ?? ""}
                onChange={(event) => controller.setDraft(event.target.value)}
                onPressEnter={(event) => {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  send();
                }}
                placeholder="发送消息"
                autoSize={{ minRows: 1, maxRows: 6 }}
                disabled={
                  isSending || historyBlocked || state.isCreatingConversation
                }
                variant="borderless"
              />
              {isSending ? (
                <Button
                  className={styles.iconButton}
                  type="primary"
                  danger
                  aria-label="停止生成"
                  icon={<StopOutlined />}
                  onClick={() => controller.stop()}
                />
              ) : (
                <Button
                  className={styles.iconButton}
                  type="primary"
                  aria-label="发送消息"
                  icon={<SendOutlined />}
                  disabled={!canSend}
                  onClick={send}
                />
              )}
            </div>
            <p className={styles.inputHint}>AI 可能会犯错，请核实重要信息</p>
          </div>
        </main>

        {state.conversationsLoading && state.conversations.length === 0 ? (
          <div className={styles.loadingOverlay}>
            <Spin />
          </div>
        ) : null}
      </div>
    </ConfigProvider>
  );
}
