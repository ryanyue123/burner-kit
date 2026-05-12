import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";
import { apiRequest, type EmailAccount, type EmailMessage } from "@/lib/api-client";
import { UserChannelClient, type ChannelOutbound } from "@/lib/user-channel-client";

const API_URL = import.meta.env.WXT_API_URL as string;

const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [anonymousClient()],
  fetchOptions: {
    credentials: "include",
  },
});

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

type MessageMap = {
  GENERATE_EMAIL: { type: "GENERATE_EMAIL" };
  GET_EMAIL_ACCOUNTS: { type: "GET_EMAIL_ACCOUNTS" };
  GET_MESSAGES: { type: "GET_MESSAGES"; accountId: string };
  GET_MESSAGE: { type: "GET_MESSAGE"; accountId: string; messageId: string };
  MARK_READ: { type: "MARK_READ"; accountId: string; messageId: string; isRead: boolean };
  DELETE_ACCOUNT: { type: "DELETE_ACCOUNT"; accountId: string };
  UPDATE_ACCOUNT: {
    type: "UPDATE_ACCOUNT";
    accountId: string;
    label?: string | null;
    expiresAt?: number | null;
  };
  GET_ME: { type: "GET_ME" };
  GET_LATEST_CODE: { type: "GET_LATEST_CODE" };
  CODE_DETECTED: { type: "CODE_DETECTED" };
};

type Message = MessageMap[keyof MessageMap];

export default defineBackground(() => {
  console.log("burner-kit background started");

  let channel: UserChannelClient | null = null;
  let bootstrapInFlight: Promise<UserChannelClient | null> | null = null;
  let bootstrapAttempts = 0;
  const BOOTSTRAP_MAX_ATTEMPTS = 6;
  const BOOTSTRAP_MAX_DELAY_MS = 30_000;

  /** Attempt to start the channel once. Returns the live client or null on
   *  failure (no session yet, network blip, …). De-duplicates concurrent
   *  callers via `bootstrapInFlight`. */
  function ensureChannel(): Promise<UserChannelClient | null> {
    if (channel) return Promise.resolve(channel);
    if (bootstrapInFlight) return bootstrapInFlight;

    bootstrapInFlight = (async () => {
      try {
        await ensureAnonymousSession();
        // Cross-origin WS upgrades from a service worker don't get the
        // Better Auth session cookie, so we authenticate via WS subprotocol
        // bearer. Token is captured here; partysocket will reuse it for
        // reconnects. Token rotation is out of scope for MVP.
        const session = await authClient.getSession();
        const token = session.data?.session?.token;
        if (!token) {
          console.warn(`[user-channel] no session token yet (attempt ${bootstrapAttempts + 1})`);
          return null;
        }
        const wsUrl = API_URL.replace(/\/$/, "").replace(/^http/, "ws") + "/api/channel/connect";
        channel = new UserChannelClient({
          url: wsUrl,
          token,
          onMessage: (msg: ChannelOutbound) => {
            chrome.runtime.sendMessage({ type: "CHANNEL_PUSH", payload: msg }).catch(() => {
              // No receiver listening — that's fine.
            });
          },
          onStateChange: (state) => console.log(`[user-channel] ${state}`),
        });
        channel.connect();
        bootstrapAttempts = 0;
        return channel;
      } catch (err) {
        console.error("[user-channel] bootstrap failed:", err);
        return null;
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  }

  /** Kick off bootstrap with exponential backoff on failure so a transient
   *  startup race (no session yet, network slow) self-heals without
   *  requiring user action. Caps at BOOTSTRAP_MAX_ATTEMPTS; after that,
   *  on-demand `ensureChannel` calls from message handlers are the recovery
   *  path. */
  async function scheduleBootstrap(): Promise<void> {
    const c = await ensureChannel();
    if (c) return;
    if (bootstrapAttempts >= BOOTSTRAP_MAX_ATTEMPTS) {
      console.warn(
        `[user-channel] giving up scheduled bootstrap after ${BOOTSTRAP_MAX_ATTEMPTS} attempts; will retry on next user action`,
      );
      return;
    }
    bootstrapAttempts++;
    const delay = Math.min(1_000 * 2 ** bootstrapAttempts, BOOTSTRAP_MAX_DELAY_MS);
    setTimeout(() => void scheduleBootstrap(), delay);
  }

  void scheduleBootstrap();

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    (async () => {
      await ensureAnonymousSession();

      switch (message.type) {
        case "GET_ME": {
          const res = await apiRequest<{ userId: string; createdAt: string; isAnonymous: boolean }>(
            "/api/me",
          );
          sendResponse(res);
          break;
        }
        case "GENERATE_EMAIL": {
          const res = await apiRequest<EmailAccount>("/api/email-accounts", { method: "POST" });
          sendResponse(res);
          if (res.ok) void ensureChannel().then((c) => c?.subscribe());
          break;
        }
        case "GET_EMAIL_ACCOUNTS": {
          const res = await apiRequest<EmailAccount[]>("/api/email-accounts");
          sendResponse(res);
          break;
        }
        case "GET_MESSAGES": {
          const res = await apiRequest<EmailMessage[]>(
            `/api/email-accounts/${message.accountId}/messages`,
          );
          sendResponse(res);
          break;
        }
        case "GET_MESSAGE": {
          const res = await apiRequest<EmailMessage>(
            `/api/email-accounts/${message.accountId}/messages/${message.messageId}`,
          );
          sendResponse(res);
          break;
        }
        case "MARK_READ": {
          const res = await apiRequest<EmailMessage>(
            `/api/email-accounts/${message.accountId}/messages/${message.messageId}`,
            { method: "PATCH", body: JSON.stringify({ isRead: message.isRead }) },
          );
          sendResponse(res);
          break;
        }
        case "DELETE_ACCOUNT": {
          const res = await apiRequest<void>(`/api/email-accounts/${message.accountId}`, {
            method: "DELETE",
          });
          sendResponse(res);
          break;
        }
        case "UPDATE_ACCOUNT": {
          const { accountId, ...body } = message;
          const res = await apiRequest<EmailAccount>(`/api/email-accounts/${accountId}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
          sendResponse(res);
          break;
        }
        case "GET_LATEST_CODE": {
          const res = await apiRequest<{ code: string; fromAddress: string; receivedAt: number }>(
            "/api/codes/latest",
          );
          sendResponse(res);
          break;
        }
        case "CODE_DETECTED": {
          void ensureChannel().then((c) => c?.subscribe());
          sendResponse({ ok: true });
          break;
        }
      }
    })();
    return true; // keep channel open for async sendResponse
  });
});
