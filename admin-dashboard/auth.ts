import { NextAuth } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

        if (!adminEmail || !adminPasswordHash) {
          console.error("Admin credentials not configured");
          return null;
        }

        // Timing-safe comparison to prevent timing attacks
        const emailMatch = await new Promise<boolean>((resolve) => {
          const isEqual = credentials.email === adminEmail;
          // Add artificial delay to prevent timing attacks
          setTimeout(() => resolve(isEqual), Math.random() * 10);
        });

        if (!emailMatch) {
          return null;
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          adminPasswordHash
        );

        if (!passwordMatch) {
          return null;
        }

        return {
          id: "1",
          email: adminEmail,
          role: "admin"
        };
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: "/login"
  }
});
