# ChatKit UI

ChatKit UI 是一个长期独立维护的聊天组件库，用于在宿主应用中接入完整的聊天界面和聊天数据流。仓库采用分层设计：`libs/core` 提供框架无关的 API 客户端、SSE 解析、请求取消和会话状态控制；`libs/react` 在 core 之上提供开箱即用的 `<ChatKit />` 组件；`apps/demo` 作为宿主示例，接入 `cc-chat` 的 FastAPI 后端。

宿主应用负责登录注册、用户校验、路由保护和凭证管理，并向组件传入自己的后端地址、接口路径、访问令牌和用户身份。组件库不保存令牌，也不关心宿主使用什么登录方式。

## 包结构

- `@chatkit-lab/chatkit-core`：框架无关的 API 客户端、SSE 解析和会话状态控制器。
- `@chatkit-lab/chatkit-react`：提供 `<ChatKit />` React 组件和样式文件。

## 宿主接入

React 宿主只需要安装 React 包，npm 会自动安装它依赖的 core 包：

```bash
npm install @chatkit-lab/chatkit-react
```

宿主应用需要提供后端地址、用户身份和访问令牌。组件库不实现登录、注册、令牌存储、令牌刷新或路由保护。

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

默认接口约定如下：

```text
GET    /conversations
POST   /conversations
GET    /conversations/{id}/messages
DELETE /conversations/{id}
POST   /chat
```

所有接口路径都可以通过 `config.paths` 替换。每次发起请求前，core 都会调用宿主传入的 `getAccessToken()` 获取最新令牌。

## 启动项目

完整启动流程如下。命令都在仓库根目录执行；当前本机路径是 `/Users/chuangchuang/Documents/mycode/cc-chat/chatkit-ui`。如果之后把它迁移为独立远程仓库，先 `git clone` 到本地，再进入 `chatkit-ui` 目录执行同样步骤。

### 1. 进入项目目录

```bash
cd /Users/chuangchuang/Documents/mycode/cc-chat/chatkit-ui
```

### 2. 启用 pnpm

仓库通过 `package.json` 的 `packageManager` 字段声明 pnpm 11.17.0。Corepack 通常随 Node.js 一起安装，首次使用前执行一次：

```bash
corepack enable
```

如果已启用过，可以跳过。

### 3. 安装依赖

```bash
pnpm install
```

安装会创建根目录和各 workspace 的 `node_modules`，并生成或更新 `pnpm-lock.yaml`。

### 4. 启动 cc-chat 后端

在另一个终端进入 `cc-chat` 的后端目录并启动 FastAPI。当前本机路径是：

```bash
cd /Users/chuangchuang/Documents/mycode/cc-chat/backend
```

首次运行时建议创建虚拟环境并安装依赖：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

按 `backend/.env.example` 配置 `.env`。聊天接口需要有效的 LLM 配置；数据库默认使用 backend 目录下的 SQLite 文件。然后启动：

```bash
python run.py
```

后端默认监听：

```text
http://127.0.0.1:8000
```

### 5. 启动 Demo

回到 `chatkit-ui` 根目录：

```bash
cd /Users/chuangchuang/Documents/mycode/cc-chat/chatkit-ui
pnpm demo
```

启动成功后访问：

```text
http://127.0.0.1:5178/
```

Demo 通过 Vite proxy 把 `/api` 请求转发到 `http://127.0.0.1:8000`。如果后端端口不同，可以用环境变量指定目标：

```bash
CHATKIT_DEMO_API_TARGET=http://127.0.0.1:8001 pnpm demo
```

打开页面后，使用 cc-chat 的邮箱和密码登录；没有账号时可以先切换到注册模式。Demo 只把访问令牌保存在自己的 `localStorage` 中，组件库仍然不保存或刷新令牌。

Demo 固定使用 `127.0.0.1:5178`，并开启了 `--strictPort`；如果端口被占用，Vite 会直接报错，不会自动切换到其他端口。可以先用下面命令确认占用进程：

```bash
lsof -nP -iTCP:5178 -sTCP:LISTEN
```

如果占用该端口的是本 demo 的旧进程，回到原终端按 `Ctrl+C` 停止后再重新启动。

### 6. 停止项目

分别在运行 FastAPI 的终端和运行 Demo 的终端按 `Ctrl+C`。停止后可以用下面命令确认端口已释放：

```bash
lsof -nP -iTCP:5178 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

## 常用命令

以下命令都在仓库根目录执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm demo
```

各命令的作用：

- `pnpm install`：安装 workspace 依赖。
- `pnpm demo`：启动本地 demo 开发服务器。
- `pnpm typecheck`：检查 core、React 和 demo 的 TypeScript 类型。
- `pnpm test`：运行 core 和 React 的单元测试与组件测试。
- `pnpm build`：构建两个可发布的 npm 包。
- `pnpm clean`：清理各 workspace 中的构建产物和测试覆盖率文件。

## 发布流程

两个公共包通过 Changesets 保持同步版本。日常变更需要添加 changeset；合并到 `main` 后，Release 工作流会创建或更新版本 PR。版本 PR 合并后自动发布到 npm。

发布前需要确认：

- npm organization `chatkit-lab` 已创建。
- GitHub 仓库中已配置 `NPM_TOKEN`。
- 两个包的公开名称没有被占用。
