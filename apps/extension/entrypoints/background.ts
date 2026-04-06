import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";
import { apiRequest, type EmailAccount, type EmailMessage, type ApiResult } from "@/lib/api-client";

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
  UPDATE_ACCOUNT: { type: "UPDATE_ACCOUNT"; accountId: string; label?: string | null; expiresAt?: number | null };
  GET_ME: { type: "GET_ME" };
};

type Message = MessageMap[keyof MessageMap];

export default defineBackground(() => {
  console.log("burner-kit background started");

  ensureAnonymousSession().catch((err) => console.error(err));

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    (async () => {
      await ensureAnonymousSession();

      switch (message.type) {
        case "GET_ME": {
          const res = await apiRequest<{ userId: string; createdAt: string; isAnonymous: boolean }>("/api/me");
          sendResponse(res);
          break;
        }
        case "GENERATE_EMAIL": {
          const res = await apiRequest<EmailAccount>("/api/email-accounts", { method: "POST" });
          sendResponse(res);
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
          const res = await apiRequest<void>(
            `/api/email-accounts/${message.accountId}`,
            { method: "DELETE" },
          );
          sendResponse(res);
          break;
        }
        case "UPDATE_ACCOUNT": {
          const { accountId, ...body } = message;
          const res = await apiRequest<EmailAccount>(
            `/api/email-accounts/${accountId}`,
            { method: "PATCH", body: JSON.stringify(body) },
          );
          sendResponse(res);
          break;
        }
      }
    })();
    return true; // keep channel open for async sendResponse
  });
});
