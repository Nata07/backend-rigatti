const {
  EmailDeliveryError,
  EmailService,
} = require("../../src/services/emailService");

describe("emailService integration", () => {
  function createLogger() {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  it("sends password reset emails with the rendered reset URL", async () => {
    const logger = createLogger();
    const provider = {
      name: "smtp",
      send: jest.fn().mockResolvedValue({
        id: "reset-1",
        accepted: ["alice@example.com"],
      }),
    };
    const service = new EmailService({
      provider,
      logger,
      frontendUrl: "https://app.example.com",
      defaultFrom: "no-reply@example.com",
    });

    const result = await service.sendPasswordReset("alice@example.com", "reset-token");

    expect(result).toEqual({
      id: "reset-1",
      accepted: ["alice@example.com"],
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        from: "no-reply@example.com",
        subject: "Password Reset Request",
        html: expect.stringContaining("https://app.example.com/reset-password?token=reset-token"),
        text: expect.stringContaining("https://app.example.com/reset-password?token=reset-token"),
        metadata: {
          template: "password-reset",
          resetUrl: "https://app.example.com/reset-password?token=reset-token",
        },
      }),
    );
  });

  it("sends verification emails with the rendered verification URL", async () => {
    const logger = createLogger();
    const provider = {
      name: "smtp",
      send: jest.fn().mockResolvedValue({
        id: "verify-1",
        accepted: ["alice@example.com"],
      }),
    };
    const service = new EmailService({
      provider,
      logger,
      frontendUrl: "https://app.example.com",
      defaultFrom: "no-reply@example.com",
    });

    await service.sendVerificationEmail("alice@example.com", "verify-token");

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Verify Your Email",
        html: expect.stringContaining("https://app.example.com/verify-email?token=verify-token"),
        text: expect.stringContaining("https://app.example.com/verify-email?token=verify-token"),
        metadata: {
          template: "email-verification",
          verificationUrl: "https://app.example.com/verify-email?token=verify-token",
        },
      }),
    );
  });

  it("serializes queued sends and logs each attempt", async () => {
    const logger = createLogger();
    const callOrder = [];
    const provider = {
      name: "smtp",
      send: jest.fn(async (message) => {
        callOrder.push(`start:${message.subject}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        callOrder.push(`end:${message.subject}`);
        return { id: message.subject };
      }),
    };
    const service = new EmailService({
      provider,
      logger,
      frontendUrl: "https://app.example.com",
    });

    const first = service.send({
      to: "one@example.com",
      subject: "first",
      html: "<p>first</p>",
      text: "first",
    });
    const second = service.send({
      to: "two@example.com",
      subject: "second",
      html: "<p>second</p>",
      text: "second",
    });

    await Promise.all([first, second]);

    expect(callOrder).toEqual(["start:first", "end:first", "start:second", "end:second"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_attempt",
        subject: "first",
      }),
      "Sending email",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_success",
        subject: "second",
      }),
      "Email sent",
    );
  });

  it("captures SMTP failures gracefully after retries", async () => {
    const logger = createLogger();
    const provider = {
      name: "smtp",
      send: jest.fn().mockRejectedValue(new Error("smtp connection refused")),
    };
    const service = new EmailService({
      provider,
      logger,
      frontendUrl: "https://app.example.com",
      retryPolicy: {
        maxAttempts: 2,
        delayMs: 1,
      },
      sleep: jest.fn().mockResolvedValue(undefined),
    });

    await expect(service.sendVerificationEmail("alice@example.com", "verify-token")).rejects.toEqual(
      expect.objectContaining({
        name: "EmailDeliveryError",
        recipient: "alice@example.com",
        attempts: 2,
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_failed",
        err: expect.any(EmailDeliveryError),
      }),
      "Email delivery failed",
    );
  });
});
