const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { Company, User } = require("../../src/models");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const {
  forgotPassword,
  loginUser,
  registerUser,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
} = require("../../src/services/authService");

describe("authService", () => {
  let mongoServer;
  let hashPassword;
  let comparePassword;
  let signToken;
  let signVerificationToken;
  let emailService;
  let logger;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), User.deleteMany({})]);

    hashPassword = jest.fn(async (password) => `hashed:${password}`);
    comparePassword = jest.fn(async (password, passwordHash) => passwordHash === `hashed:${password}`);
    signToken = jest.fn((payload) => `token:${payload.userId}:${payload.role}`);
    signVerificationToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "24h",
    });
    emailService = {
      sendPasswordReset: jest.fn().mockResolvedValue({ id: "reset-1" }),
      sendVerificationEmail: jest.fn().mockResolvedValue({ id: "verification-1" }),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
    };
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("creates a company and assigns admin role to the first user", async () => {
    const result = await registerUser(
      {
        name: "Alice",
        email: "Alice@Example.com",
        password: "password123",
        companyName: "Acme",
      },
      { hashPassword, signToken, emailService, signVerificationToken, logger }
    );

    const company = await Company.findOne({ normalizedName: "acme" });
    const user = await User.findOne({ email: "alice@example.com" }).lean();

    expect(company).toBeTruthy();
    expect(user.role).toBe("admin");
    expect(user.verified).toBe(false);
    expect(user.passwordHash).toBe("hashed:password123");
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
    expect(result.user).toEqual({
      id: user._id.toString(),
      companyId: company._id.toString(),
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
      verified: false,
    });
    expect(result.user.passwordHash).toBeUndefined();
    expect(signToken).toHaveBeenCalledWith({
      userId: user._id.toString(),
      companyId: company._id.toString(),
      role: "admin",
    });
  });

  it("assigns user role when the company already exists", async () => {
    const company = await Company.create({ name: "Acme" });

    const result = await registerUser(
      {
        name: "Bob",
        email: "bob@example.com",
        password: "password123",
        companyName: "acme",
      },
      { hashPassword, signToken }
    );

    const user = await User.findOne({ email: "bob@example.com" }).lean();

    expect(user.companyId.toString()).toBe(company._id.toString());
    expect(user.role).toBe("user");
    expect(result.user.role).toBe("user");
  });

  it("returns a 409 error when the email already exists", async () => {
    const company = await Company.create({ name: "Acme" });

    await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
    });

    await expect(
      registerUser(
        {
          name: "Alice Two",
          email: "alice@example.com",
          password: "password456",
          companyName: "Other",
        },
        { hashPassword, signToken }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Email already in use",
    });
  });

  it("assigns user role when company creation loses a normalized-name race", async () => {
    const existingCompany = await Company.create({ name: "Acme" });
    const findOneSpy = jest
      .spyOn(Company, "findOne")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingCompany);
    const createSpy = jest.spyOn(Company, "create").mockRejectedValueOnce({
      code: 11000,
      keyPattern: { normalizedName: 1 },
    });

    const result = await registerUser(
      {
        name: "Carol",
        email: "carol@example.com",
        password: "password123",
        companyName: "Acme",
      },
      { hashPassword, signToken }
    );

    const user = await User.findOne({ email: "carol@example.com" }).lean();

    expect(user.companyId.toString()).toBe(existingCompany._id.toString());
    expect(user.role).toBe("user");
    expect(result.user.role).toBe("user");

    createSpy.mockRestore();
    findOneSpy.mockRestore();
  });

  it("returns 409 when user creation hits a duplicate email race", async () => {
    await Company.create({ name: "Acme" });
    const userCreateSpy = jest.spyOn(User, "create").mockRejectedValueOnce({
      code: 11000,
      keyPattern: { email: 1 },
    });

    await expect(
      registerUser(
        {
          name: "Alice",
          email: "alice@example.com",
          password: "password123",
          companyName: "Acme",
        },
        { hashPassword, signToken }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Email already in use",
    });

    userCreateSpy.mockRestore();
  });

  it("returns a token for valid login credentials", async () => {
    const company = await Company.create({ name: "Acme" });
    const user = await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
    });

    const result = await loginUser(
      {
        email: "alice@example.com",
        password: "password123",
      },
      { comparePassword, signToken }
    );

    expect(comparePassword).toHaveBeenCalledWith("password123", "hashed:password123");
    expect(result.token).toBe(`token:${user._id.toString()}:admin`);
    expect(result.user.passwordHash).toBeUndefined();
  });

  it("returns 401 when the email is not found", async () => {
    await expect(
      loginUser(
        {
          email: "missing@example.com",
          password: "password123",
        },
        { comparePassword, signToken }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid email or password",
    });
  });

  it("returns 401 when the password is invalid", async () => {
    const company = await Company.create({ name: "Acme" });
    await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
    });
    comparePassword.mockResolvedValue(false);

    await expect(
      loginUser(
        {
          email: "alice@example.com",
          password: "wrong-password",
        },
        { comparePassword, signToken }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid email or password",
    });
  });

  it("rethrows unexpected persistence errors", async () => {
    const userCreateSpy = jest.spyOn(User, "create").mockRejectedValueOnce(new Error("db down"));

    await expect(
      registerUser(
        {
          name: "Alice",
          email: "alice@example.com",
          password: "password123",
          companyName: "Acme",
        },
        { hashPassword, signToken }
      )
    ).rejects.toThrow("db down");

    userCreateSpy.mockRestore();
  });

  it("generates a 15 minute reset token and sends the password reset email", async () => {
    const company = await Company.create({ name: "Acme" });
    await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
    });
    const passwordResetEmailService = {
      sendPasswordReset: jest.fn().mockResolvedValue({ id: "reset-1" }),
    };
    const signResetToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "15m",
    });

    await forgotPassword("Alice@Example.com", {
      emailService: passwordResetEmailService,
      signResetToken,
      logger,
    });

    expect(passwordResetEmailService.sendPasswordReset).toHaveBeenCalledWith("alice@example.com", expect.any(String));

    const [, token] = passwordResetEmailService.sendPasswordReset.mock.calls[0];
    const payload = jwt.decode(token);
    expect(payload).toMatchObject({
      userId: expect.any(String),
      type: "password-reset",
    });
    expect(payload.exp - payload.iat).toBe(900);
  });

  it("does not send reset email for unknown users", async () => {
    const passwordResetEmailService = {
      sendPasswordReset: jest.fn(),
    };

    await forgotPassword("missing@example.com", {
      emailService: passwordResetEmailService,
      signResetToken: jest.fn(),
      logger,
    });

    expect(passwordResetEmailService.sendPasswordReset).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth_password_reset_requested",
        userExists: false,
      }),
      "Password reset requested",
    );
  });

  it("hashes and saves the new password during reset", async () => {
    const company = await Company.create({ name: "Acme" });
    const user = await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
    });
    const verifyResetToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    const token = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "15m",
    })({
      userId: user._id.toString(),
      type: "password-reset",
    });

    await resetPassword(token, "new-password123", {
      hashPassword,
      verifyResetToken,
      logger,
    });

    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser.passwordHash).toBe("hashed:new-password123");
  });

  it("returns 400 when the reset token is expired", async () => {
    const verifyResetToken = jest.fn(() => {
      const error = new Error("jwt expired");
      error.name = "TokenExpiredError";
      throw error;
    });

    await expect(
      resetPassword("expired-token", "new-password123", {
        hashPassword,
        verifyResetToken,
        logger,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Reset token expired",
    });
  });

  it("returns 400 when the token type is invalid", async () => {
    const verifyResetToken = jest.fn(() => ({
      userId: "user-1",
      type: "access-token",
    }));

    await expect(
      resetPassword("invalid-token", "new-password123", {
        hashPassword,
        verifyResetToken,
        logger,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid token",
    });
  });

  it("sends a 24 hour verification token during registration", async () => {
    await registerUser(
      {
        name: "Alice",
        email: "alice@example.com",
        password: "password123",
        companyName: "Acme",
      },
      { hashPassword, signToken, emailService, signVerificationToken, logger }
    );

    const [, token] = emailService.sendVerificationEmail.mock.calls[0];
    const payload = jwt.decode(token);
    expect(payload).toMatchObject({
      userId: expect.any(String),
      type: "email-verification",
    });
    expect(payload.exp - payload.iat).toBe(86400);
  });

  it("resends verification email only for existing unverified users", async () => {
    const company = await Company.create({ name: "Acme" });
    await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
      verified: false,
    });
    await User.create({
      companyId: company._id,
      name: "Bob",
      email: "bob@example.com",
      passwordHash: "hashed:password123",
      role: "user",
      verified: true,
    });

    await resendVerificationEmail("alice@example.com", {
      emailService,
      signVerificationToken,
      logger,
    });
    await resendVerificationEmail("bob@example.com", {
      emailService,
      signVerificationToken,
      logger,
    });
    await resendVerificationEmail("missing@example.com", {
      emailService,
      signVerificationToken,
      logger,
    });

    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
  });

  it("marks the user as verified when the verification token is valid", async () => {
    const company = await Company.create({ name: "Acme" });
    const user = await User.create({
      companyId: company._id,
      name: "Alice",
      email: "alice@example.com",
      passwordHash: "hashed:password123",
      role: "admin",
      verified: false,
    });
    const verifyVerificationToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    const token = signVerificationToken({
      userId: user._id.toString(),
      type: "email-verification",
    });

    await verifyEmail(token, {
      verifyVerificationToken,
      logger,
    });

    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser.verified).toBe(true);
  });

  it("returns 400 when the verification token is expired", async () => {
    const verifyVerificationToken = jest.fn(() => {
      const error = new Error("jwt expired");
      error.name = "TokenExpiredError";
      throw error;
    });

    await expect(
      verifyEmail("expired-token", {
        verifyVerificationToken,
        logger,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Verification token expired",
    });
  });
});
