import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatController } from "../chatController";
import type { ChatKitFetch } from "../types";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("chat controller", () => {
  let fetchMock: ChatKitFetch;

  beforeEach(() => {
    fetchMock = vi.fn(async (input, init) => {
      const method = init?.method ?? "GET";

      if (method === "GET" && String(input).endsWith("/conversations")) {
        return jsonResponse([
          { id: 1, title: "Conversation", created_at: "", updated_at: "" },
        ]);
      }
      if (
        method === "GET" &&
        String(input).endsWith("/conversations/1/messages")
      ) {
        return jsonResponse([
          {
            id: 1,
            role: "assistant",
            content: "History",
            created_at: "",
          },
        ]);
      }
      if (method === "POST" && String(input).endsWith("/chat")) {
        return streamResponse([
          'data: {"content":"He"}\n\n',
          'data: {"content":"llo"}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      return jsonResponse({ detail: "not found" }, { status: 404 });
    }) as ChatKitFetch;
  });

  it("loads conversation history per selected conversation", async () => {
    const controller = createChatController({
      identity: "user",
      config: {
        baseUrl: "https://api.test",
        getAccessToken: () => "token",
        fetch: fetchMock,
      },
    });

    await controller.initialize();
    expect(controller.getState().conversations).toHaveLength(1);

    await controller.selectConversation(1);
    expect(controller.getState().chats[1]?.messages[0]?.content).toBe(
      "History",
    );
    controller.destroy();
  });

  it("sends the active draft and appends streamed assistant content", async () => {
    const getAccessToken = vi.fn(() => "token");
    const controller = createChatController({
      identity: "user",
      config: {
        baseUrl: "https://api.test",
        getAccessToken,
        fetch: fetchMock,
      },
    });
    await controller.initialize();
    await controller.selectConversation(1);
    controller.setDraft("Hello");
    await controller.sendMessage();

    const chat = controller.getState().chats[1];
    expect(chat?.messages.map((message) => message.content)).toEqual([
      "History",
      "Hello",
      "Hello",
    ]);
    expect(chat?.isLoading).toBe(false);
    // initialize(), history, chat, and the post-stream conversation refresh
    // each request a fresh token instead of reusing a captured value.
    expect(getAccessToken).toHaveBeenCalledTimes(4);
    controller.destroy();
  });

  it("notifies the host for an unauthorized request", async () => {
    const onUnauthorized = vi.fn();
    const unauthorizedFetch = vi.fn(async () =>
      jsonResponse({ detail: "expired" }, { status: 401 }),
    ) as ChatKitFetch;
    const controller = createChatController({
      identity: "user",
      config: {
        baseUrl: "https://api.test",
        getAccessToken: () => "token",
        fetch: unauthorizedFetch,
        onUnauthorized,
      },
    });

    await controller.initialize();
    expect(onUnauthorized).toHaveBeenCalledWith({
      status: 401,
      requestPath: "/conversations",
    });
    expect(controller.getState().conversationsError).toBe("expired");
    controller.destroy();
  });

  it("uses paths from the latest controller config", async () => {
    const v2Fetch = vi.fn(async () =>
      jsonResponse([
        { id: 2, title: "V2 conversation", created_at: "", updated_at: "" },
      ]),
    ) as ChatKitFetch;
    const controller = createChatController({
      identity: "user",
      config: {
        baseUrl: "https://api.test",
        getAccessToken: () => "token",
        fetch: fetchMock,
      },
    });

    await controller.initialize();
    controller.updateConfig({
      baseUrl: "https://api.test",
      getAccessToken: () => "token",
      fetch: v2Fetch,
      paths: { conversations: "/v2/conversations" },
    });
    await controller.listConversations();

    expect(v2Fetch).toHaveBeenCalledWith(
      "https://api.test/v2/conversations",
      expect.anything(),
    );
    expect(controller.getState().conversations[0]?.title).toBe(
      "V2 conversation",
    );
    controller.destroy();
  });
});
