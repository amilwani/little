import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Little only asks for `drive.file`: it can see the files it creates in the
// user's Drive and nothing else. Google treats this as a non-sensitive scope.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    access_token?: string;
    expires_at?: number;
    refresh_token?: string;
    error?: "RefreshTokenError";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // First sign-in: keep Google's tokens in the encrypted session cookie.
      if (account) {
        return {
          ...token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          refresh_token: account.refresh_token,
        };
      }
      // Token still valid for at least another minute.
      if (token.expires_at && Date.now() < (token.expires_at - 60) * 1000) {
        return token;
      }
      if (!token.refresh_token) {
        return { ...token, error: "RefreshTokenError" as const };
      }
      // Refresh the access token so Drive keeps working between visits.
      try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
          }),
        });
        const refreshed = (await res.json()) as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
        };
        if (!res.ok) throw refreshed;
        return {
          ...token,
          access_token: refreshed.access_token,
          expires_at: Math.floor(Date.now() / 1000 + refreshed.expires_in),
          refresh_token: refreshed.refresh_token ?? token.refresh_token,
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshTokenError" as const };
      }
    },
    async session({ session, token }) {
      // The browser talks to Drive directly, so it needs the access token.
      // Our server never stores notes.
      session.accessToken = token.access_token;
      session.error = token.error;
      return session;
    },
  },
});
