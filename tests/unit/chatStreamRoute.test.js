const express = require("express");
const request = require("supertest");

const createChatStreamRouter = require("../../src/routes/chatStream");

describe("chatStream route", () => {
  it("times out inactive streams and closes the SSE response", async () => {
    const authenticate = (req, _res, next) => {
      req.auth = {
        userId: "user-123",
        companyId: "company-123",
        role: "user",
      };
      req.id = "request-123";
      next();
    };
    const chatService = {
      streamChatCompletion: jest.fn(() => new Promise(() => {})),
    };
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
    };
    const app = express();
    app.use(express.json());
    app.use(
      "/api/chat/stream",
      createChatStreamRouter({
        authenticate,
        chatService,
        logger,
        streamTimeoutMs: 25,
      })
    );

    const response = await request(app).post("/api/chat/stream").send({ message: "Hello" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("event: start");
    expect(response.text).toContain("event: error");
    expect(response.text).toContain("Streaming timed out");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-123",
        timedOut: true,
      }),
      "Chat stream failed"
    );
  });
});
