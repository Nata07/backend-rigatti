const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildActionUrl,
  createSmtpEmailProvider,
  EmailDeliveryError,
  EmailService,
  FileTemplateRenderer,
} = require("../../src/services/emailService");

describe("emailService unit", () => {
  function createLogger() {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  it("creates an SMTP transporter and maps sendMail results", async () => {
    const sendMail = jest.fn().mockResolvedValue({
      messageId: "smtp-1",
      accepted: ["alice@example.com"],
      rejected: [],
      response: "250 OK",
    });
    const transporter = { sendMail };
    const createTransport = jest.fn().mockReturnValue(transporter);

    const provider = createSmtpEmailProvider({
      host: "smtp.example.com",
      port: 2525,
      secure: true,
      user: "smtp-user",
      pass: "smtp-pass",
      from: "no-reply@example.com",
      createTransport,
    });

    const result = await provider.send({
      to: "alice@example.com",
      subject: "Password Reset Request",
      html: "<p>hello</p>",
      text: "hello",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 2525,
      secure: true,
      auth: {
        user: "smtp-user",
        pass: "smtp-pass",
      },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "alice@example.com",
      subject: "Password Reset Request",
      html: "<p>hello</p>",
      text: "hello",
    });
    expect(result).toEqual({
      id: "smtp-1",
      accepted: ["alice@example.com"],
      rejected: [],
      response: "250 OK",
    });
  });

  it("renders HTML templates from files with plain text fallback", async () => {
    const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), "email-templates-"));
    fs.writeFileSync(
      path.join(templateDir, "password-reset.html"),
      "<html><body><h1>Hello</h1><p><a href=\"{{actionUrl}}\">Reset</a></p></body></html>",
      "utf8",
    );

    const renderer = new FileTemplateRenderer(templateDir);
    const rendered = await renderer.render("password-reset", {
      actionUrl: "https://app.example.com/reset-password?token=abc",
    });

    expect(rendered.html).toContain("https://app.example.com/reset-password?token=abc");
    expect(rendered.text).toContain("Reset (https://app.example.com/reset-password?token=abc)");
  });

  it("retries provider failures before succeeding", async () => {
    const logger = createLogger();
    const sleep = jest.fn().mockResolvedValue(undefined);
    const provider = {
      name: "smtp",
      send: jest
        .fn()
        .mockRejectedValueOnce(new Error("temporary smtp failure"))
        .mockResolvedValueOnce({ id: "delivered" }),
    };
    const service = new EmailService({
      provider,
      logger,
      frontendUrl: "https://app.example.com",
      retryPolicy: {
        maxAttempts: 2,
        delayMs: 25,
      },
      sleep,
      templateRenderer: {
        render: jest.fn().mockResolvedValue({
          html: "<p>hello</p>",
          text: "hello",
        }),
      },
    });

    const result = await service.send({
      to: "alice@example.com",
      subject: "Queued email",
      html: "<p>hello</p>",
      text: "hello",
    });

    expect(result).toEqual({ id: "delivered" });
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_retry",
        attempt: 1,
      }),
      "Email delivery failed, scheduling retry",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_success",
        attempt: 2,
      }),
      "Email sent",
    );
  });

  it("raises a delivery error after exhausting retries", async () => {
    const logger = createLogger();
    const provider = {
      name: "smtp",
      send: jest.fn().mockRejectedValue(new Error("mailbox unavailable")),
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

    await expect(
      service.send({
        to: "alice@example.com",
        subject: "Queued email",
        html: "<p>hello</p>",
        text: "hello",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "EmailDeliveryError",
        attempts: 2,
        recipient: "alice@example.com",
        providerName: "smtp",
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_send_failed",
        attempt: 2,
        err: expect.any(EmailDeliveryError),
      }),
      "Email delivery failed",
    );
  });

  it("builds frontend URLs consistently", () => {
    expect(buildActionUrl("https://app.example.com", "/verify-email", "abc123")).toBe(
      "https://app.example.com/verify-email?token=abc123",
    );
  });
});
