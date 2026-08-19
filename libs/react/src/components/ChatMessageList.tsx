import { RobotOutlined, UserOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import type { Message } from "@chatkit-lab/chatkit-core";
import MarkdownRenderer from "./MarkdownRenderer";
import styles from "../ChatMessageList.module.css";

interface ChatMessageListProps {
  /** 当前会话消息；流式内容通过替换 assistant 消息对象更新。 */
  messages: Message[];
  /** 当前会话是否正在等待或接收流式回复。 */
  isLoading: boolean;
  /** 会话列表仍在加载时先保留骨架区域，避免空状态闪现。 */
  emptyVisible: boolean;
}

export default function ChatMessageList({
  messages,
  isLoading,
  emptyVisible,
}: ChatMessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const lastId = lastMessage?.id ?? null;
    // 新消息始终滚动到底；同一消息的流式增量只在用户已经接近底部时跟随。
    const isNewMessage = lastMessageIdRef.current !== lastId;
    lastMessageIdRef.current = lastId;

    if (!isNewMessage) {
      const distanceToBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight;
      if (distanceToBottom > 80) return;
    }

    bottomRef.current?.scrollIntoView({
      behavior: isNewMessage ? "smooth" : "auto",
      block: "end",
    });
  }, [lastMessage?.id, messages]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <RobotOutlined />
        </div>
        {emptyVisible ? (
          <>
            <h2 className={styles.emptyTitle}>有什么可以帮你</h2>
            <p className={styles.emptyText}>输入消息，开始对话</p>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={listRef} className={styles.list}>
      <div className={styles.listInner}>
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={
                isUser ? styles.messageRowUser : styles.messageRowAssistant
              }
            >
              <div
                className={isUser ? styles.avatarUser : styles.avatarAssistant}
              >
                {isUser ? <UserOutlined /> : <RobotOutlined />}
              </div>
              <div
                className={isUser ? styles.bubbleUser : styles.bubbleAssistant}
              >
                {message.role === "assistant" ? (
                  message.content ? (
                    <MarkdownRenderer content={message.content} />
                  ) : isLoading ? (
                    <span className={styles.typingDot} />
                  ) : null
                ) : (
                  <span className={styles.userText}>{message.content}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
