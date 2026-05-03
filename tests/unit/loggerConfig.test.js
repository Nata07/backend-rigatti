const { PassThrough } = require("stream");

const { createLogger } = require("../../src/config/logger");

describe("structured logger configuration", () => {
  function createBufferedLogger(level = "info") {
    const stream = new PassThrough();
    const chunks = [];

    stream.on("data", (chunk) => {
      chunks.push(chunk.toString("utf8"));
    });

    return {
      logger: createLogger(level, stream),
      readEntries() {
        return chunks
          .join("")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      },
    };
  }

  it("emits JSON logs with redaction and serializers", () => {
    const { logger, readEntries } = createBufferedLogger();

    logger.info(
      {
        password: "secret",
        token: "abc123",
        req: {
          id: "req-1",
          method: "POST",
          originalUrl: "/api/auth/login",
          headers: {
            authorization: "Bearer top-secret",
            "user-agent": "jest",
          },
          ip: "127.0.0.1",
        },
        res: {
          statusCode: 201,
          getHeader(name) {
            if (name === "content-length") {
              return "321";
            }

            return undefined;
          },
        },
      },
      "login attempt",
    );

    const [entry] = readEntries();

    expect(entry).toEqual(
      expect.objectContaining({
        level: "info",
        message: "login attempt",
        service: "mini-saas-backend",
        req: expect.objectContaining({
          id: "req-1",
          method: "POST",
          url: "/api/auth/login",
          remoteAddress: "127.0.0.1",
          headers: expect.objectContaining({
            "user-agent": "jest",
          }),
        }),
        res: {
          statusCode: 201,
          contentLength: 321,
        },
      }),
    );
    expect(entry.password).toBeUndefined();
    expect(entry.token).toBeUndefined();
    expect(entry.req.headers.authorization).toBeUndefined();
  });

  it("supports the debug level explicitly required by the task", () => {
    const { logger, readEntries } = createBufferedLogger("debug");

    logger.debug({ metric: "request_duration_ms", value: 12.5 }, "debug metric");

    const [entry] = readEntries();

    expect(entry.level).toBe("debug");
    expect(entry.metric).toBe("request_duration_ms");
  });
});
