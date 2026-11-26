<div align="center">

<img src="icon.svg" width="256" height="256" alt="dsh-workspace-registry icon">

# dsh-workspace-registry

**Register a project once so Prism can find the right codebase when a user describes a task.**

English | [简体中文](README.zh_CN.md)

</div>

## Set up Prism

Use Node.js 24.9 or later, npm, Git and credentials with read access to the five private plugin repositories. The checkout script places matching plugins and launcher files in a local `runtime/` directory. Run subsequent installation, configuration and launch commands there. The public guide is available without signing in. To use the example models, configure your DeepSeek credentials in DSH or set the `DEEPSEEK_API_KEY` environment variable. [Installation guide](https://prism.dsh-plug.in/)

```sh
git clone https://github.com/dsh-plugins/dsh-prism.git
cd dsh-prism
node scripts/checkout.mjs
cd runtime
npm ci
npm run build
npm start
```

## Make a project discoverable

Copy `prism.example.json` to `prism.config.json` in your local `runtime/` directory. Add an entry to `registry.projects`. Choose a stable ID and describe what the project contains in the terms your users use. Set `workspace` to its directory and `nodeId` to the ID of the device that holds it.

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

This example lets the Web owner search and read the mobile project. Choose the actual project path, owner and tool permissions for your deployment. Set `orchestrator.defaultProjectId` to a project that the conversation owner can access. Restart with your configuration, then try “Find the mobile client and check where the login screen is implemented.”

```sh
npm start -- prism.config.json --host 127.0.0.1 --port 3080 --no-open
```

[Prism documentation](https://prism.dsh-plug.in/) · [Technical reference](docs/TECH.md)
