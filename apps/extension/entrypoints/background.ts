import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";

const API_URL = import.meta.env.WXT_API_URL as string;

const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [anonymousClient()],
  fetchOptions: {
    credentials: "include",
  },
});

type GetMeResponse =
  | { ok: true; user: { userId: string; createdAt: string; isAnonymous: boolean } }
  | { ok: false; error: string };

async function ensureAnonymousSession(): Promise<void> {
  try {
    const session = await authClient.getSession();
    if (session.data?.user) return;
  } catch (err) {
    console.warn("getSession failed, attempting anonymous sign-in", err);
  }
  const result = await authClient.signIn.anonymous();
  if (result.error) {
    console.error("anonymous sign-in failed", result.error);
    throw new Error(result.error.message ?? "anonymous sign-in failed");
  }
  console.log("anonymous sign-in succeeded");
}

async function fetchMe(): Promise<GetMeResponse> {
  try {
    const res = await fetch(`${API_URL}/api/me`, { credentials: "include" });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const user = (await res.json()) as {
      userId: string;
      createdAt: string;
      isAnonymous: boolean;
    };
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default defineBackground(() => {
  console.log("burner-kit background started");

  // Auto sign-in on SW start (install + subsequent wakeups are both handled;
  // if a session already exists, ensureAnonymousSession is a no-op).
  ensureAnonymousSession().catch((err) => console.error(err));

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_ME") {
      (async () => {
        await ensureAnonymousSession();
        const result = await fetchMe();
        sendResponse(result);
      })();
      return true; // keep the message channel open for async sendResponse
    }
    return false;
  });
});
