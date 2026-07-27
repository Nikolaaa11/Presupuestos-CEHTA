import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      companyId: string | null;
      companyCode: string | null;
      companyName: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    companyId: string | null;
    companyCode: string | null;
    companyName: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: string;
    companyId?: string | null;
    companyCode?: string | null;
    companyName?: string | null;
  }
}
