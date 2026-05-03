const { formatStreamEvent } = require("../../src/types/stream");

describe("stream types", () => {
  it("formats SSE events with the expected event and data lines", () => {
    expect(
      formatStreamEvent({
        type: "tool_call",
        data: {
          id: "call-1",
          name: "search_products",
          argumentsJson: "{\"query\":\"keyboard\"}",
        },
      })
    ).toBe(
      "event: tool_call\ndata: {\"id\":\"call-1\",\"name\":\"search_products\",\"argumentsJson\":\"{\\\"query\\\":\\\"keyboard\\\"}\"}\n\n"
    );
  });
});
