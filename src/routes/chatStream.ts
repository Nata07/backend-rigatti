import express, { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";

import type { ChatService } from "../services/chatService";
import { formatStreamEvent, type StreamEvent, type StreamEventType } from "../types/stream";

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

export interface ChatStreamRouterDependencies {
  authenticate: Middleware;
  requireVerified?: Middleware;
  chatService: ChatService;
  logger: Logger;
  streamTimeoutMs?: number;
  streamRateLimiter?: Middleware;
}

export default function createChatStreamRouter({
  authenticate,
  requireVerified,
  chatService,
  logger,
  streamTimeoutMs = 30_000,
  streamRateLimiter,
}: ChatStreamRouterDependencies) {
  const router = express.Router();

  router.use(authenticate);

  router.post(
    "/",
    ...(requireVerified ? [requireVerified] : []),
    ...(streamRateLimiter ? [streamRateLimiter] : []),
    (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const abortController = new AbortController();
      let streamFinished = false;
      let tokenCount = 0;
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort("stream-timeout");
      }, streamTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
      };

      const sendEvent = <T extends StreamEventType>(event: StreamEvent<T>) => {
        if (streamFinished || res.writableEnded || res.destroyed) {
          return;
        }

        if (event.type === "token") {
          tokenCount += 1;
        } else {
          logger.info(
            {
              requestId: req.id,
              eventType: event.type,
              userId: req.auth?.userId,
              companyId: req.auth?.companyId,
            },
            "Chat stream event",
          );
        }

        res.write(formatStreamEvent(event));
      };

      res.on("close", () => {
        if (!streamFinished && !abortController.signal.aborted) {
          logger.info(
            {
              requestId: req.id,
              userId: req.auth?.userId,
              companyId: req.auth?.companyId,
            },
            "Chat stream client disconnected",
          );
          abortController.abort("client-disconnected");
        }
        cleanup();
      });

      try {
        sendEvent({ type: "start", data: {} });

        const result = await Promise.race([
          chatService.streamChatCompletion(
            req.body,
            req.auth!,
            {
              onToken: async (token) => {
                sendEvent({ type: "token", data: token });
              },
              onToolCall: async (toolCall) => {
                sendEvent({ type: "tool_call", data: toolCall });
              },
              onToolResult: async (toolResult) => {
                sendEvent({ type: "tool_result", data: toolResult });
              },
            },
            { signal: abortController.signal },
          ),
          waitForAbort(abortController.signal),
        ]);

        sendEvent({
          type: "complete",
          data: {
            conversationId: result.conversation._id,
          },
        });

        logger.info(
          {
            requestId: req.id,
            userId: req.auth?.userId,
            companyId: req.auth?.companyId,
            tokenCount,
          },
          "Chat stream completed",
        );
      } catch (error) {
        if (abortController.signal.aborted && !timedOut) {
          return;
        }

        const message = timedOut ? "Streaming timed out" : toErrorMessage(error);
        sendEvent({
          type: "error",
          data: {
            message,
          },
        });

        logger.error(
          {
            err: error,
            requestId: req.id,
            userId: req.auth?.userId,
            companyId: req.auth?.companyId,
            timedOut,
          },
          "Chat stream failed",
        );

        if (!res.headersSent) {
          next(error);
          return;
        }
      } finally {
        streamFinished = true;
        cleanup();
        if (!res.writableEnded && !res.destroyed) {
          res.end();
        }
      }
    })().catch((error: unknown) => {
      cleanupResponse(res);
      next(error);
    });
    },
  );

  return router;
}

function toErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return "Streaming failed";
}

function cleanupResponse(res: Response): void {
  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(new Error("Request aborted"));
  }

  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Request aborted"));
      },
      { once: true },
    );
  });
}
