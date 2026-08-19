import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ChatKit } from "@chatkit-lab/chatkit-react";
import "@chatkit-lab/chatkit-react/styles.css";
import {
  clearPersistedAccessToken,
  login,
  readPersistedAccessToken,
  registerAndLogin,
  restoreSession,
  type DemoUser,
} from "./auth";

type AuthMode = "login" | "register";

/**
 * Demo 演示的是宿主职责：先登录 cc-chat，再把用户 ID 和访问令牌传给
 * ChatKit。ChatKit 组件包本身不包含这个认证流程。
 */
export default function App() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(() =>
    Boolean(readPersistedAccessToken()),
  );
  const [currentUser, setCurrentUser] = useState<DemoUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const token = readPersistedAccessToken();
    if (!token) return;

    // 本地 token 只作为恢复线索；是否有效由后端 /users/me 判断。
    void restoreSession(token)
      .then((user) => {
        setAccessToken(token);
        setCurrentUser(user);
      })
      .catch(() => {
        setAuthError("登录状态已失效，请重新登录");
      })
      .finally(() => setIsRestoringSession(false));
  }, []);

  const handleUnauthorized = useCallback(() => {
    // ChatKit 报告 401 后由宿主清理凭证并返回登录页，不尝试刷新 token。
    clearPersistedAccessToken();
    setAccessToken(null);
    setCurrentUser(null);
    setAuthError("登录已过期，请重新登录");
  }, []);

  const config = useMemo(
    () => ({
      // Vite proxy 负责把 /api 转发到 cc-chat 后端。
      baseUrl: "/api",
      // 每次请求前重新读取 state 中的 token，保持与宿主登出/401 处理同步。
      getAccessToken: () => accessToken ?? "",
      onUnauthorized: handleUnauthorized,
    }),
    [accessToken],
  );

  function handleLogout() {
    clearPersistedAccessToken();
    setAccessToken(null);
    setCurrentUser(null);
    setAuthError(null);
  }

  async function submitAuthEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      // 注册和登录都完成后才进入 ChatKit，确保 identity 来自后端用户记录。
      const session =
        mode === "login"
          ? await login(email, password)
          : await registerAndLogin(email, password);
      setAccessToken(session.accessToken);
      setCurrentUser(session.user);
    } catch (error) {
      setAuthError(
        error instanceof Error && error.message
          ? error.message
          : "请求失败，请确认后端已启动",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isRestoringSession) {
    return (
      <main className="authScreen">
        <p className="authStatus">正在恢复登录状态...</p>
      </main>
    );
  }

  if (!currentUser || !accessToken) {
    return (
      <main className="authScreen">
        <section className="authCard">
          <h1>ChatKit Demo</h1>
          <p className="authIntro">登录 cc-chat 后端后进入聊天界面</p>

          <div className="authMode" role="group" aria-label="认证模式">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setAuthError(null);
              }}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setAuthError(null);
              }}
            >
              注册
            </button>
          </div>

          <form className="authForm" onSubmit={submitAuthEvent}>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {authError ? (
              <p className="authError" role="alert">
                {authError}
              </p>
            ) : null}

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "提交中..." : mode === "login" ? "登录" : "注册"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="currentUser" title={currentUser.email}>
          {currentUser.email}
        </span>
        <button type="button" onClick={handleLogout}>
          退出登录
        </button>
      </header>

      <div className="chatFrame">
        <ChatKit identity={currentUser.id} config={config} />
      </div>
    </div>
  );
}
