import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatKitFetch } from "@chatkit-lab/chatkit-core";
import ChatKit from "./ChatKit";

function json(response: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(response), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

describe("ChatKit", () => {
  it("loads conversations through the host config", async () => {
    const fetchMock = vi.fn(async () =>
      json([{ id: 1, title: "Existing chat", created_at: "", updated_at: "" }]),
    ) as ChatKitFetch;

    const { container } = render(
      <ChatKit
        identity="user-1"
        config={{
          baseUrl: "https://example.test",
          getAccessToken: () => "token",
          fetch: fetchMock,
        }}
      />,
    );

    expect(await screen.findByText("Existing chat")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("chatkit-root");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/conversations",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("renders an initial shell on the server without issuing requests", () => {
    const fetchMock = vi.fn() as ChatKitFetch;
    const html = renderToString(
      <ChatKit
        identity="user-1"
        config={{
          baseUrl: "https://example.test",
          getAccessToken: () => "token",
          fetch: fetchMock,
        }}
      />,
    );

    expect(html).toContain("chatkit-root");
    expect(html).toContain("有什么可以帮你");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
