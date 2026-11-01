"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect } from "react";

/** The signed-in user's Google access token, for talking to Drive. */
export function useAccessToken() {
  const { data, status } = useSession();
  useEffect(() => {
    // Google access was revoked or expired for good: sign in again.
    if (data?.error === "RefreshTokenError") signIn("google");
  }, [data?.error]);
  return { token: data?.accessToken ?? null, status, user: data?.user };
}
