export type StreamEventType = "start" | "token" | "tool_call" | "tool_result" | "complete" | "error";

export interface StreamToolCallEvent {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface StreamToolResultEvent {
  toolCallId: string;
  name: string;
  content: string;
}

export interface StreamCompleteEvent {
  conversationId: string;
}

export interface StreamErrorEvent {
  message: string;
}

export interface StreamEventDataMap {
  start: Record<string, never>;
  token: string;
  tool_call: StreamToolCallEvent;
  tool_result: StreamToolResultEvent;
  complete: StreamCompleteEvent;
  error: StreamErrorEvent;
}

export interface StreamEvent<T extends StreamEventType = StreamEventType> {
  type: T;
  data: StreamEventDataMap[T];
}

export function formatStreamEvent<T extends StreamEventType>(event: StreamEvent<T>): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
