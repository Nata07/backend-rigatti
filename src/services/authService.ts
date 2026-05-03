import { Company, User } from "../models";
import type { AuthContext, UserRole } from "../types/auth";
import type { EmailService } from "./emailService";

interface ObjectIdLike {
  toString(): string;
}

interface HttpError extends Error {
  statusCode: number;
}

interface DuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, number>;
}

interface CompanyDocument {
  _id: ObjectIdLike | string;
}

interface UserDocument {
  _id: ObjectIdLike | string;
  companyId: ObjectIdLike | string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  verified: boolean;
  save(): Promise<UserDocument>;
}

interface PasswordResetTokenPayload {
  userId: string;
  type: "password-reset";
  iat?: number;
  exp?: number;
}

interface EmailVerificationTokenPayload {
  userId: string;
  type: "email-verification";
  iat?: number;
  exp?: number;
}

interface LoggerLike {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
}

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface AuthUserSummary {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: UserRole;
  verified: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUserSummary;
}

export interface RegisterUserDependencies {
  hashPassword(password: string): Promise<string>;
  signToken(authContext: AuthContext): string;
  emailService?: Pick<EmailService, "sendVerificationEmail">;
  signVerificationToken?(payload: EmailVerificationTokenPayload): string;
  logger?: LoggerLike;
}

export interface LoginUserDependencies {
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  signToken(authContext: AuthContext): string;
}

export interface ForgotPasswordDependencies {
  emailService: Pick<EmailService, "sendPasswordReset">;
  signResetToken(payload: PasswordResetTokenPayload): string;
  logger?: LoggerLike;
}

export interface ResetPasswordDependencies {
  hashPassword(password: string): Promise<string>;
  verifyResetToken(token: string): PasswordResetTokenPayload;
  logger?: LoggerLike;
}

export interface ResendVerificationDependencies {
  emailService: Pick<EmailService, "sendVerificationEmail">;
  signVerificationToken(payload: EmailVerificationTokenPayload): string;
  logger?: LoggerLike;
}

export interface VerifyEmailDependencies {
  verifyVerificationToken(token: string): EmailVerificationTokenPayload;
  logger?: LoggerLike;
}

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function toEntityId(value: ObjectIdLike | string): string {
  return typeof value === "string" ? value : value.toString();
}

function toUserSummary(user: UserDocument): AuthUserSummary {
  return {
    id: toEntityId(user._id),
    companyId: toEntityId(user.companyId),
    name: user.name,
    email: user.email,
    role: user.role,
    verified: user.verified,
  };
}

function isDuplicateKeyError(error: unknown, key: string): error is DuplicateKeyError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const duplicateError = error as DuplicateKeyError;
  return duplicateError.code === 11000 && Boolean(duplicateError.keyPattern?.[key]);
}

function buildAuthContext(user: UserDocument, companyId: ObjectIdLike | string): AuthContext {
  return {
    userId: toEntityId(user._id),
    companyId: toEntityId(companyId),
    role: user.role,
  };
}

export async function registerUser(
  { name, email, password, companyName }: RegisterUserInput,
  { hashPassword, signToken, emailService, signVerificationToken, logger }: RegisterUserDependencies,
): Promise<AuthResponse> {
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = (await User.findOne({ email: normalizedEmail })) as UserDocument | null;

  if (existingUser) {
    throw createHttpError(409, "Email already in use");
  }

  const normalizedCompanyName = companyName.trim().toLowerCase();
  let company = (await Company.findOne({
    normalizedName: normalizedCompanyName,
  })) as CompanyDocument | null;
  let role: UserRole = "user";

  if (!company) {
    try {
      company = (await Company.create({ name: companyName })) as CompanyDocument;
      role = "admin";
    } catch (error) {
      if (isDuplicateKeyError(error, "normalizedName")) {
        company = (await Company.findOne({
          normalizedName: normalizedCompanyName,
        })) as CompanyDocument | null;

        if (!company) {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  try {
    const user = (await User.create({
      companyId: company._id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      role,
      verified: false,
    })) as UserDocument;
    const authContext = buildAuthContext(user, company._id);

    logger?.info(
      {
        event: "auth_registration_completed",
        userId: toEntityId(user._id),
        companyId: toEntityId(company._id),
        email: normalizedEmail,
        role,
      },
      "User registration completed",
    );

    if (emailService && signVerificationToken) {
      const verificationToken = signVerificationToken({
        userId: toEntityId(user._id),
        type: "email-verification",
      });

      await emailService.sendVerificationEmail(normalizedEmail, verificationToken);

      logger?.info(
        {
          event: "auth_verification_email_sent",
          userId: toEntityId(user._id),
          email: normalizedEmail,
        },
        "Verification email queued",
      );
    }

    return {
      token: signToken(authContext),
      user: toUserSummary(user),
    };
  } catch (error) {
    if (isDuplicateKeyError(error, "email")) {
      throw createHttpError(409, "Email already in use");
    }

    throw error;
  }
}

export async function loginUser(
  { email, password }: LoginUserInput,
  { comparePassword, signToken }: LoginUserDependencies,
): Promise<AuthResponse> {
  const user = (await User.findOne({
    email: email.trim().toLowerCase(),
  })) as UserDocument | null;

  if (!user) {
    throw createHttpError(401, "Invalid email or password");
  }

  const isValidPassword = await comparePassword(password, user.passwordHash);

  if (!isValidPassword) {
    throw createHttpError(401, "Invalid email or password");
  }

  const authContext = buildAuthContext(user, user.companyId);

  return {
    token: signToken(authContext),
    user: toUserSummary(user),
  };
}

export async function forgotPassword(
  email: string,
  { emailService, signResetToken, logger }: ForgotPasswordDependencies,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = (await User.findOne({ email: normalizedEmail })) as UserDocument | null;

  logger?.info(
    {
      event: "auth_password_reset_requested",
      email: normalizedEmail,
      userExists: Boolean(user),
    },
    "Password reset requested",
  );

  if (!user) {
    return;
  }

  const resetToken = signResetToken({
    userId: toEntityId(user._id),
    type: "password-reset",
  });

  await emailService.sendPasswordReset(normalizedEmail, resetToken);

  logger?.info(
    {
      event: "auth_password_reset_email_sent",
      userId: toEntityId(user._id),
      email: normalizedEmail,
    },
    "Password reset email queued",
  );
}

export async function resetPassword(
  token: string,
  newPassword: string,
  { hashPassword, verifyResetToken, logger }: ResetPasswordDependencies,
): Promise<void> {
  let payload: PasswordResetTokenPayload;

  try {
    payload = verifyResetToken(token);
  } catch (error) {
    const errorName =
      error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : undefined;
    const message = errorName === "TokenExpiredError" ? "Reset token expired" : "Invalid token";
    logger?.warn(
      {
        event: "auth_password_reset_rejected",
        reason: message,
      },
      "Password reset token rejected",
    );
    throw createHttpError(400, message);
  }

  if (payload.type !== "password-reset") {
    logger?.warn(
      {
        event: "auth_password_reset_rejected",
        reason: "Invalid token type",
      },
      "Password reset token rejected",
    );
    throw createHttpError(400, "Invalid token");
  }

  const user = (await User.findById(payload.userId)) as UserDocument | null;

  if (!user) {
    logger?.warn(
      {
        event: "auth_password_reset_rejected",
        reason: "User not found",
        userId: payload.userId,
      },
      "Password reset token rejected",
    );
    throw createHttpError(404, "User not found");
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  logger?.info(
    {
      event: "auth_password_reset_completed",
      userId: payload.userId,
    },
    "Password reset completed",
  );
}

export async function resendVerificationEmail(
  email: string,
  { emailService, signVerificationToken, logger }: ResendVerificationDependencies,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = (await User.findOne({ email: normalizedEmail })) as UserDocument | null;

  logger?.info(
    {
      event: "auth_verification_resend_requested",
      email: normalizedEmail,
      userExists: Boolean(user),
      alreadyVerified: user?.verified ?? false,
    },
    "Verification email resend requested",
  );

  if (!user || user.verified) {
    return;
  }

  const verificationToken = signVerificationToken({
    userId: toEntityId(user._id),
    type: "email-verification",
  });

  await emailService.sendVerificationEmail(normalizedEmail, verificationToken);

  logger?.info(
    {
      event: "auth_verification_resend_sent",
      userId: toEntityId(user._id),
      email: normalizedEmail,
    },
    "Verification email resent",
  );
}

export async function verifyEmail(
  token: string,
  { verifyVerificationToken, logger }: VerifyEmailDependencies,
): Promise<void> {
  let payload: EmailVerificationTokenPayload;

  try {
    payload = verifyVerificationToken(token);
  } catch (error) {
    const errorName =
      error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : undefined;
    const message = errorName === "TokenExpiredError" ? "Verification token expired" : "Invalid token";
    logger?.warn(
      {
        event: "auth_verification_rejected",
        reason: message,
      },
      "Email verification token rejected",
    );
    throw createHttpError(400, message);
  }

  if (payload.type !== "email-verification") {
    logger?.warn(
      {
        event: "auth_verification_rejected",
        reason: "Invalid token type",
      },
      "Email verification token rejected",
    );
    throw createHttpError(400, "Invalid token");
  }

  const user = (await User.findById(payload.userId)) as UserDocument | null;

  if (!user) {
    logger?.warn(
      {
        event: "auth_verification_rejected",
        reason: "User not found",
        userId: payload.userId,
      },
      "Email verification token rejected",
    );
    throw createHttpError(404, "User not found");
  }

  if (user.verified) {
    logger?.info(
      {
        event: "auth_verification_already_completed",
        userId: payload.userId,
      },
      "Email already verified",
    );
    return;
  }

  user.verified = true;
  await user.save();

  logger?.info(
    {
      event: "auth_verification_completed",
      userId: payload.userId,
    },
    "Email verification completed",
  );
}
