import type { AuthContext } from "../../src/types/auth";

const authContext: AuthContext = {
  userId: "user-1",
  companyId: "company-1",
  role: "admin",
};

console.log(`ts-node-ok:${authContext.role}`);
