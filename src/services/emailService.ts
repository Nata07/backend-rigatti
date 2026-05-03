import fs from "fs/promises";
import path from "path";

import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "pino";

import type {
  EmailMessage,
  EmailProvider,
  EmailRetryPolicy,
  EmailSendResult,
  EmailTemplateName,
  EmailTemplateRenderer,
  RenderedEmailTemplate,
} from "../types/email";

const DEFAULT_TEMPLATE_DIRECTORY = path.resolve(__dirname, "../templates");
const DEFAULT_RETRY_POLICY: EmailRetryPolicy = {
  maxAttempts: 3,
  delayMs: 250,
};

interface LoggerLike {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

interface QueueEntry {
  message: EmailMessage;
  resolve(result: EmailSendResult): void;
  reject(error: unknown): void;
}

export interface SmtpProviderOptions {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
  createTransport?: typeof nodemailer.createTransport;
}

export interface EmailServiceOptions {
  provider: EmailProvider;
  logger: Logger | LoggerLike;
  frontendUrl: string;
  defaultFrom?: string;
  retryPolicy?: Partial<EmailRetryPolicy>;
  templateRenderer?: EmailTemplateRenderer;
  sleep?(delayMs: number): Promise<void>;
}

export interface SmtpEmailProvider extends EmailProvider {
  transporter: Transporter;
}

export class EmailDeliveryError extends Error {
  readonly attempts: number;
  readonly recipient: string;
  readonly providerName: string;
  readonly cause: unknown;

  constructor(message: string, options: { attempts: number; recipient: string; providerName: string; cause: unknown }) {
    super(message);
    this.name = "EmailDeliveryError";
    this.attempts = options.attempts;
    this.recipient = options.recipient;
    this.providerName = options.providerName;
    this.cause = options.cause;
  }
}

export class FileTemplateRenderer implements EmailTemplateRenderer {
  constructor(private readonly templateDirectory = DEFAULT_TEMPLATE_DIRECTORY) {}

  async render(templateName: EmailTemplateName, variables: Record<string, string>): Promise<RenderedEmailTemplate> {
    const templatePath = path.join(this.templateDirectory, `${templateName}.html`);
    const template = await fs.readFile(templatePath, "utf8");
    const html = interpolateTemplate(template, variables);

    return {
      html,
      text: htmlToText(html),
    };
  }
}

export class EmailService {
  private readonly queue: QueueEntry[] = [];
  private readonly templateRenderer: EmailTemplateRenderer;
  private readonly retryPolicy: EmailRetryPolicy;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private isProcessing = false;

  constructor(private readonly options: EmailServiceOptions) {
    this.templateRenderer = options.templateRenderer ?? new FileTemplateRenderer();
    this.retryPolicy = {
      maxAttempts: options.retryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
      delayMs: options.retryPolicy?.delayMs ?? DEFAULT_RETRY_POLICY.delayMs,
    };
    this.sleep = options.sleep ?? wait;
  }

  async sendPasswordReset(email: string, token: string): Promise<EmailSendResult> {
    const resetUrl = buildActionUrl(this.options.frontendUrl, "/reset-password", token);
    const template = await this.templateRenderer.render("password-reset", {
      actionUrl: resetUrl,
      recipientEmail: email,
    });

    return this.enqueue(
      this.createTemplatedMessage(email, "Password Reset Request", template, {
        template: "password-reset",
        resetUrl,
      }),
    );
  }

  async sendVerificationEmail(email: string, token: string): Promise<EmailSendResult> {
    const verificationUrl = buildActionUrl(this.options.frontendUrl, "/verify-email", token);
    const template = await this.templateRenderer.render("email-verification", {
      actionUrl: verificationUrl,
      recipientEmail: email,
    });

    return this.enqueue(
      this.createTemplatedMessage(email, "Verify Your Email", template, {
        template: "email-verification",
        verificationUrl,
      }),
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    return this.enqueue(message);
  }

  private enqueue(message: EmailMessage): Promise<EmailSendResult> {
    return new Promise<EmailSendResult>((resolve, reject) => {
      this.queue.push({ message, resolve, reject });
      this.processQueue().catch((error) => {
        this.options.logger.error({ err: error }, "Email queue processing failed");
      });
    });
  }

  private createTemplatedMessage(
    to: string,
    subject: string,
    template: RenderedEmailTemplate,
    metadata: Record<string, unknown>,
  ): EmailMessage {
    const message: EmailMessage = {
      to,
      subject,
      html: template.html,
      text: template.text,
      metadata,
    };

    if (this.options.defaultFrom) {
      message.from = this.options.defaultFrom;
    }

    return message;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();

        if (!entry) {
          continue;
        }

        try {
          const result = await this.sendWithRetry(entry.message);
          entry.resolve(result);
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async sendWithRetry(message: EmailMessage): Promise<EmailSendResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
      this.options.logger.info(
        {
          event: "email_send_attempt",
          attempt,
          maxAttempts: this.retryPolicy.maxAttempts,
          provider: this.options.provider.name,
          to: message.to,
          subject: message.subject,
          metadata: message.metadata,
        },
        "Sending email",
      );

      try {
        const result = await this.options.provider.send(message);

        this.options.logger.info(
          {
            event: "email_send_success",
            attempt,
            provider: this.options.provider.name,
            to: message.to,
            subject: message.subject,
            result,
            metadata: message.metadata,
          },
          "Email sent",
        );

        return result;
      } catch (error) {
        lastError = error;
        const wrappedError = normalizeEmailError(error, message.to, this.options.provider.name, attempt);
        const canRetry = attempt < this.retryPolicy.maxAttempts;

        this.options.logger[canRetry ? "warn" : "error"](
          {
            event: canRetry ? "email_send_retry" : "email_send_failed",
            attempt,
            maxAttempts: this.retryPolicy.maxAttempts,
            provider: this.options.provider.name,
            to: message.to,
            subject: message.subject,
            err: wrappedError,
            metadata: message.metadata,
          },
          canRetry ? "Email delivery failed, scheduling retry" : "Email delivery failed",
        );

        if (canRetry) {
          await this.sleep(this.retryPolicy.delayMs * attempt);
        }
      }
    }

    throw normalizeEmailError(
      lastError,
      message.to,
      this.options.provider.name,
      this.retryPolicy.maxAttempts,
    );
  }
}

export function createSmtpEmailProvider({
  host,
  port = 587,
  secure = false,
  user,
  pass,
  from,
  createTransport = nodemailer.createTransport,
}: SmtpProviderOptions): SmtpEmailProvider {
  const transporter = createTransport({
    host,
    port,
    secure,
    auth: user || pass ? { user, pass } : undefined,
  });

  return {
    name: "smtp",
    transporter,
    async send(message: EmailMessage) {
      const info = await transporter.sendMail({
        from: message.from ?? from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      const result: EmailSendResult = {};

      if (info.messageId) {
        result.id = info.messageId;
      }

      if (Array.isArray(info.accepted)) {
        result.accepted = info.accepted.map(String);
      }

      if (Array.isArray(info.rejected)) {
        result.rejected = info.rejected.map(String);
      }

      if (typeof info.response === "string") {
        result.response = info.response;
      }

      return result;
    },
  };
}

export function buildActionUrl(frontendUrl: string, routePath: string, token: string): string {
  const base = new URL(frontendUrl.endsWith("/") ? frontendUrl : `${frontendUrl}/`);
  const url = new URL(routePath.replace(/^\//, ""), base);
  url.searchParams.set("token", token);
  return url.toString();
}

export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<\/(p|div|h1|h2|h3|li|section|br)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeEmailError(
  error: unknown,
  recipient: string,
  providerName: string,
  attempts: number,
): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown email delivery error";

  return new EmailDeliveryError(`Unable to deliver email to ${recipient}: ${message}`, {
    attempts,
    recipient,
    providerName,
    cause: error,
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
