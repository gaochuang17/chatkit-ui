# @chatkit-lab/chatkit-react

`@chatkit-lab/chatkit-react` 是基于 `@chatkit-lab/chatkit-core` 的 React 聊天组件，导出 `<ChatKit />`。

```tsx
import { ChatKit } from "@chatkit-lab/chatkit-react";
import "@chatkit-lab/chatkit-react/styles.css";

<ChatKit
  identity={currentUser.id}
  config={{
    baseUrl: "https://chat-api.example.com",
    getAccessToken: async () => hostAccessToken,
    onUnauthorized: () => navigate("/login"),
  }}
/>;
```

## 宿主职责

宿主应用负责登录、注册、路由、用户校验和令牌刷新。React 18 和 React 19 都受支持，`react` 与 `react-dom` 是 peer dependencies。Ant Design、图标、Markdown 和代码高亮依赖已打包进组件库，宿主不需要额外安装。

组件的 ESM 和 CJS 入口都可以在 Node 环境安全导入，并支持服务端渲染初始界面。

## 配置更新

当 `identity`、`baseUrl` 或 `config.paths` 变化时，React 层会重建 controller 并清空已缓存的会话。`getAccessToken`、`headers`、`onUnauthorized`、`onError` 等回调配置变化时，只更新当前 controller，不会清空聊天状态。

## 样式

样式入口为：

```ts
import "@chatkit-lab/chatkit-react/styles.css";
```

组件根节点固定带 `.chatkit-root` 类名，宿主可以通过 `className` 和 `style` 继续扩展布局。Ant Design 类名前缀固定为 `chatkit-ant`，避免和宿主自身的 Ant Design 样式互相影响。
