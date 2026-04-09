const API_URL = import.meta.env.WXT_API_URL as string;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        ok: false,
        error: body ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` },
      };
    }
    // 204 No Content (e.g. DELETE)
    if (res.status === 204) {
      return { ok: true, data: undefined as T };
    }
    const data = await res.json();
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: (err as Error).message } };
  }
}

export type EmailAccount = {
  id: string;
  email: string;
  domain: string;
  label: string | null;
  createdAt: number;
  expiresAt: number | null;
  unreadCount?: number;
};

export type EmailMessage = {
  id: string;
  emailAccountId: string;
  fromAddress: string;
  subject: string | null;
  textContent: string | null;
  htmlContent: string | null;
  receivedAt: number;
  isRead: boolean;
};
