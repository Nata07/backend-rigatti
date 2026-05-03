export type EmailTemplateName = "password-reset" | "email-verification";

export interface EmailAddress {
  address: string;
  name?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  id?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailRetryPolicy {
  maxAttempts: number;
  delayMs: number;
}

export interface RenderedEmailTemplate {
  html: string;
  text: string;
}

export interface EmailTemplateRenderer {
  render(templateName: EmailTemplateName, variables: Record<string, string>): Promise<RenderedEmailTemplate>;
}
