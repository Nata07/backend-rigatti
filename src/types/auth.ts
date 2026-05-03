import type { EntityId, Timestamped } from "./common";

export type UserRole = "admin" | "user";

export interface AuthContext {
  userId: EntityId;
  companyId: EntityId;
  role: UserRole;
}

export interface JwtClaims extends AuthContext {
  iat?: number;
  exp?: number;
}

export interface User extends Timestamped {
  id: EntityId;
  companyId: EntityId;
  name: string;
  email: string;
  passwordHash?: string;
  role: UserRole;
  verified: boolean;
}
