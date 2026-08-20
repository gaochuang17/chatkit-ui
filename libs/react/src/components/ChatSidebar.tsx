import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { Conversation } from "@chatkit-lab/chatkit-core";
import styles from "../ChatSidebar.module.css";

interface ChatSidebarProps {
  /** 宿主传入的会话列表；组件按数组原顺序渲染，不自行排序。 */
  conversations: Conversation[];
  /** 当前选中的会话 ID；新会话草稿页为 null。 */
  activeConversationId: number | null;
  /** 会话列表请求进行中时优先显示加载文案。 */
  loading: boolean;
  onSelect: (conversationId: number) => void | Promise<void>;
  onNew: () => void;
  onDelete: (conversationId: number) => void | Promise<void>;
}

export default function ChatSidebar({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: ChatSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <Button
          className={styles.newButton}
          icon={<PlusOutlined />}
          onClick={onNew}
        >
          新对话
        </Button>
      </div>

      <div className={styles.list} role="list">
        {loading && conversations.length === 0 ? (
          <p className={styles.emptyText}>正在加载会话</p>
        ) : null}
        {!loading && conversations.length === 0 ? (
          <p className={styles.emptyText}>暂无会话</p>
        ) : null}

        {conversations.map((conversation) => {
          // The product list is title-only; deletion is the sole trailing action.
          const isActive = conversation.id === activeConversationId;
          return (
            <div
              key={conversation.id}
              role="listitem"
              className={isActive ? styles.itemActive : styles.item}
            >
              <button
                type="button"
                className={styles.itemButton}
                onClick={() => void onSelect(conversation.id)}
              >
                <span className={styles.itemTitle}>{conversation.title}</span>
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                aria-label={`删除 ${conversation.title}`}
                onClick={() => void onDelete(conversation.id)}
              >
                <DeleteOutlined />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
