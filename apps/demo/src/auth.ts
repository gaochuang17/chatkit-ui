export interface DemoUser {
  /** cc-chat 后端返回的 UUID；ChatKit 用它区分不同用户的本地状态。 */
  id: string;
  email: string;
}

interface LoginResponse {
  access_token: string;
}

interface ValidationDetail {
  msg?: unknown;
}

const API_BASE = "/api";
// 登录凭证由 demo 宿主持有；发布后的 ChatKit 包不会读写这个 key。
const TOKEN_STORAGE_KEY = "chatkit-demo/access-token";

export function readPersistedAccessToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearPersistedAccessToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function persistAccessToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string" && body.detail) return body.detail;
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      return body.detail
        .map((item: ValidationDetail) =>
          typeof item?.msg === "string" ? item.msg : "",
        )
        .filter(Boolean)
        .join("; ");
    }
    return JSON.stringify(body);
  } catch {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}

/** Demo 宿主自己的 JSON 请求封装，与 ChatKit core 的 API client 相互独立。 */
async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function fetchUser(accessToken: string): Promise<DemoUser> {
  return requestJson<DemoUser>("/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: DemoUser; accessToken: string }> {
  const formData = new URLSearchParams();
  // fastapi-users 的 JWT 登录接口使用 OAuth2 表单格式，而不是 JSON。
  formData.append("username", email);
  formData.append("password", password);

  const response = await fetch(`${API_BASE}/auth/jwt/login`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error("邮箱或密码错误");
  }
  console.log("===response", response);

  const data = (await response.json()) as LoginResponse;
  if (!data.access_token) throw new Error("登录接口未返回访问令牌");

  const user = await fetchUser(data.access_token);
  persistAccessToken(data.access_token);
  return { user, accessToken: data.access_token };
}

export async function registerAndLogin(
  email: string,
  password: string,
): Promise<{ user: DemoUser; accessToken: string }> {
  // 先注册再立即登录，让 demo 保持单一登录入口并复用 token 保存逻辑。
  await requestJson<void>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return login(email, password);
}

export async function restoreSession(accessToken: string): Promise<DemoUser> {
  try {
    return await fetchUser(accessToken);
  } catch (error) {
    // /users/me 校验失败说明本地 token 已不可用，恢复失败时立即移除。
    clearPersistedAccessToken();
    throw error;
  }
}
