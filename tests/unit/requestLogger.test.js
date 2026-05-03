const express = require("express");
const request = require("supertest");

const { requestLogger } = require("../../src/middleware/requestLogger");

describe("requestLogger", () => {
  it("assigns a request id when the client does not provide one", async () => {
    const requestScopedLogger = { info: jest.fn() };
    const logger = {
      child: jest.fn().mockReturnValue(requestScopedLogger),
    };
    const app = express();

    app.use(requestLogger({ logger }));
    app.get("/probe", (req, res) => {
      res.json({ requestId: req.id });
    });

    const response = await request(app).get("/probe");

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeTruthy();
    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
    expect(logger.child).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: response.body.requestId,
        correlationId: response.body.requestId,
      }),
    );
    expect(requestScopedLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request_completed",
        durationMs: expect.any(Number),
        performance: {
          durationMs: expect.any(Number),
        },
        req: expect.objectContaining({
          id: response.body.requestId,
          method: "GET",
          url: "/probe",
        }),
        res: expect.objectContaining({
          statusCode: 200,
        }),
      }),
      "Request completed",
    );
  });
});
