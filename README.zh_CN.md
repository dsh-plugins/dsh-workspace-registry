<div align="center">

<img src="icon.svg" width="256" height="256" alt="dsh-workspace-registry 图标">

# dsh-workspace-registry

**登记项目后，棱镜可根据用户对任务的描述找到相应的代码库。**

[English](README.md) | 简体中文

</div>

## 接入棱镜

需要 Node.js 24.9 或更高版本、npm、Git，以及对五个私有插件仓库的 Git 读取权限。检出脚本把匹配的插件和启动文件放入本机的 `runtime/` 目录，后续安装、配置和运行命令均在该目录执行。公开使用指南可直接阅读。需要调用示例模型时，请先在 DSH 凭据存储中配置 DeepSeek 凭据，或设置环境变量 `DEEPSEEK_API_KEY`。[安装指南](https://prism.dsh-plug.in/zh/)

```sh
git clone https://github.com/dsh-plugins/dsh-prism.git
cd dsh-prism
node scripts/checkout.mjs
cd runtime
npm ci
npm run build
npm start
```

## 让项目可被找到

在本机的 `runtime/` 中将 `prism.example.json` 复制为 `prism.config.json`，在 `registry.projects` 中增加一项。选择稳定的 ID，用用户熟悉的名称描述项目用途。将 `workspace` 指向项目目录，将 `nodeId` 设为存放项目的设备 ID。

```json
{
  "id": "mobile",
  "description": "Mobile client and shared UI components",
  "stack": ["TypeScript", "React"],
  "nodeId": "local",
  "workspace": "/srv/projects/mobile",
  "principals": ["web:owner"],
  "permissions": ["read", "glob", "grep"]
}
```

示例允许 Web 所有者检索和读取移动端工程。请按部署环境填写实际目录、所有者和工具权限，并把 `orchestrator.defaultProjectId` 指向该对话所有者可访问的项目。使用配置重启后，可以试着问「找到移动客户端，看看登录页在哪里实现」。

```sh
npm start -- prism.config.json --host 127.0.0.1 --port 3080 --no-open
```

[棱镜使用指南](https://prism.dsh-plug.in/zh/) · [技术参考](docs/TECH.md)
