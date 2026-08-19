import { describe, expect, it } from "vitest";
import { createSSEParser, parseSSEData } from "../sse";

describe("SSE parser", () => {
  it("keeps partial events until a blank-line boundary", () => {
    const parser = createSSEParser();

    expect(parser.push('data: {"con')).toEqual([]);
    expect(parser.push('tent":"he')).toEqual([]);
    expect(parser.push('llo"}\n')).toEqual([]);
    expect(parser.push("\ndata: [DONE]\n\n")).toEqual([
      '{"content":"hello"}',
      "[DONE]",
    ]);
  });

  it("supports LF, CRLF, CR separators and multiple data lines", () => {
    const parser = createSSEParser();

    expect(
      parser.push("data: first\r\ndata: second\r\rdata: [DONE]\n\n"),
    ).toEqual(["first\nsecond", "[DONE]"]);
  });

  it("flushes an event that ends without a trailing blank line", () => {
    const parser = createSSEParser();
    expect(parser.push("data: [DONE]")).toEqual([]);
    expect(parser.flush()).toEqual(["[DONE]"]);
  });

  it("classifies content, stream errors, and completion", () => {
    expect(parseSSEData('{"content":"hello"}')).toEqual({
      type: "content",
      content: "hello",
    });
    expect(parseSSEData('{"error":"failed"}')).toEqual({
      type: "error",
      error: "failed",
    });
    expect(parseSSEData("[DONE]")).toEqual({ type: "done" });
  });
});
