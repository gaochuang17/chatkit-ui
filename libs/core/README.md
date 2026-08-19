# @chatkit-lab/chatkit-core

`@chatkit-lab/chatkit-core` 是 ChatKit 的框架无关核心层，包含 API 客户端、SSE 解析和实例级会话状态控制。它不依赖 React 或 Vue，也不存储任何身份凭证。

```ts
import { createChatController } from "@chatkit-lab/chatkit-core";

const controller = createChatController({
  identity: currentUser.id,
  config: {
    baseUrl: "https://chat-api.example.com",
    getAccessToken: async () => hostAccessToken,
  },
});

await controller.initialize();
```

## 接口约定

默认路径如下：

```text
GET    /conversations
POST   /conversations
GET    /conversations/{id}/messages
DELETE /conversations/{id}
POST   /chat
```

每个路径都可以通过 `config.paths` 替换。接口响应字段和 SSE 数据格式属于公开契约：

```text
data: {"content":"text"}
data: {"error":"message"}
data: [DONE]
```

## 认证边界

`getAccessToken()` 会在每次请求前调用，core 不会缓存令牌，也不会读取浏览器存储、校验用户或刷新凭证。

当接口返回 401 时，core 会调用 `config.onUnauthorized()`，由宿主应用决定跳转登录、刷新凭证还是展示错误。

core 不包含登录、注册、用户校验或路由保护逻辑。
