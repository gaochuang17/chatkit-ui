export interface SSEEventData {
  /** `content` 是增量文本，`error` 是服务端流错误，`done` 是正常结束。 */
  type: "content" | "error" | "done" | "ignored";
  content?: string;
  error?: string;
  data?: string;
}

export interface SSEParser {
  /** 输入一个网络 chunk，返回其中已经形成完整事件的 data 字段。 */
  push(chunk: string): string[];
  /** 输入流结束，返回最后一个没有空行结尾的事件。 */
  flush(): string[];
}

/** 解析单条 SSE data 内容；无法识别的内容返回 `ignored` 交给调用方报错。 */
export function parseSSEData(rawData: string): SSEEventData {
  const data = rawData.trim();
  if (data === "[DONE]") return { type: "done" };

  try {
    const parsed = JSON.parse(data) as { content?: unknown; error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) {
      return { type: "error", error: parsed.error };
    }
    if (typeof parsed.content === "string") {
      return { type: "content", content: parsed.content };
    }
  } catch {
    // Fall through and report malformed event data.
  }

  return { type: "ignored", data };
}

/**
 * 创建有状态 SSE 解析器。字节流由调用方先用流式 TextDecoder 解码，
 * 本解析器只负责保留未到空行边界的事件尾部，直到下一个 chunk 或 flush()。
 */
export function createSSEParser(): SSEParser {
  let buffer = "";

  const extract = (normalizeInput: string): string[] => {
    const normalized = normalizeInput.replace(/\r\n|\r/g, "\n");
    const events = normalized.split("\n\n");
    buffer = events.pop() ?? "";
    return events;
  };

  const parseEvent = (event: string): string | null => {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""));
    if (dataLines.length === 0) return null;
    return dataLines.join("\n");
  };

  return {
    push(chunk: string) {
      return extract(buffer + chunk)
        .map(parseEvent)
        .filter((data): data is string => data !== null);
    },
    flush() {
      const remaining = buffer;
      buffer = "";
      const data = parseEvent(remaining);
      return data === null ? [] : [data];
    },
  };
}

export async function readSSEStream(
  response: Response,
  onData: (data: string) => boolean | void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Chat response has no readable body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();

  let cancelledByConsumer = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const decoded = decoder.decode(value, { stream: true });
      for (const data of parser.push(decoded)) {
        if (onData(data) === false) {
          cancelledByConsumer = true;
          break;
        }
      }
      if (cancelledByConsumer) break;
    }

    if (cancelledByConsumer) {
      // 消费者收到 [DONE] 后已拿到完整回复，主动取消 body，避免等待
      // 一个可能长时间不关闭的 SSE 连接。
      await reader.cancel().catch(() => undefined);
      return;
    }

    const tail = decoder.decode();
    for (const data of parser.push(tail)) onData(data);
    for (const data of parser.flush()) onData(data);
  } finally {
    reader.releaseLock();
  }
}
