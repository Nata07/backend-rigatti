const express = require("express");
const request = require("supertest");

const { errorHandler } = require("../../src/middleware/errorHandler");

describe("errorHandler", () => {
  function buildApp(error) {
    const app = express();
    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };

    app.get("/boom", (req, res, next) => {
      req.id = "test-request-id";
      req.log = logger;
      req.requestStartedAt = process.hrtime.bigint();
      next(error);
    });
    app.use(errorHandler({ logger }));

    return { app, logger };
  }

  it.each([
    [400, "Bad request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not found"],
  ])("formats known errors for status %s", async (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;

    const { app, logger } = buildApp(error);
    const response = await request(app).get("/boom");

    expect(response.status).toBe(statusCode);
    expect(response.body).toEqual({
      error: {
        message,
        statusCode,
        requestId: "test-request-id",
      },
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "request_failed",
        statusCode,
        durationMs: expect.any(Number),
        req: expect.objectContaining({
          id: "test-request-id",
          method: "GET",
          url: "/boom",
        }),
        err: expect.objectContaining({
          message,
        }),
      }),
      "Request failed",
    );
  });

  it("formats unknown errors as 500", async () => {
    const { app, logger } = buildApp(new Error("Unexpected failure"));
    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        message: "Unexpected failure",
        statusCode: 500,
        requestId: "test-request-id",
      },
    });
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "request_failed",
        statusCode: 500,
        err: expect.objectContaining({
          message: "Unexpected failure",
        }),
      }),
      "Request failed",
    );
  });

  it("delegates when headers were already sent", () => {
    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    const middleware = errorHandler({ logger });
    const next = jest.fn();
    const error = new Error("late failure");
    const req = {
      id: "req-1",
      originalUrl: "/stream",
      method: "GET",
      log: logger,
      requestStartedAt: process.hrtime.bigint(),
    };
    const res = { headersSent: true, getHeader: jest.fn() };

    middleware(error, req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
