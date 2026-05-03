import express, { type NextFunction, type Request, type Response } from "express";

import type { ChatService, ChatServiceResult, SerializedConversation } from "../services/chatService";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string | undefined;
  };
}

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

type GetConversationResponse = SerializedConversation | ErrorResponseBody;
type ProcessMessageResponse = ChatServiceResult | ErrorResponseBody;

export interface ChatRouterDependencies {
  authenticate: Middleware;
  requireVerified?: Middleware;
  chatService: ChatService;
  chatRateLimiter?: Middleware;
}

export default function createChatRouter({
  authenticate,
  requireVerified,
  chatService,
  chatRateLimiter,
}: ChatRouterDependencies) {
  const router = express.Router();

  router.use(authenticate);

  router.get(
    "/",
    (
      req: Request,
      res: Response<GetConversationResponse>,
      next: NextFunction,
    ): void => {
      void (async () => {
        const conversation = await chatService.getActiveConversation(req.auth!);
        res.status(200).json(conversation);
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  router.post(
    "/",
    ...(requireVerified ? [requireVerified] : []),
    ...(chatRateLimiter ? [chatRateLimiter] : []),
    (
      req: Request,
      res: Response<ProcessMessageResponse>,
      next: NextFunction,
    ): void => {
      void (async () => {
        const result = await chatService.processMessage(req.body, req.auth!);
        res.status(200).json(result);
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  return router;
}
