# 项目注册表技术参考

完整应用使用五个私有插件仓库，需要已获全部读取权限的 Git 凭据。在公开仓库根目录执行 `node scripts/checkout.mjs` 后进入 `runtime/`，再从该目录运行 npm、配置和启动命令。官网和使用文档可公开访问。[棱镜官网](https://prism.dsh-plug.in/)

棱镜的项目元数据索引。L1 的查询工具只接收当前对话所有者有权访问的项目，包括 ID、简介、技术栈、节点 ID、Git 远端和执行工具权限。工作区绝对路径仅由宿主派发时解析。

## 配置

在 Cordis 插件配置中填写 `projects`，或设置 `catalogFile` 指向内容为相同项目数组的 UTF-8 JSON 文件。索引在插件启动时校验和加载。修改索引后重新加载插件。

```yaml
projects:
  - id: mobile
    description: 客户端应用与组件库
    stack: [TypeScript, React]
    nodeId: laptop
    workspace: /srv/projects/mobile
    gitRemote: https://git.example.org/team/mobile.git
    principals: '*'
    permissions: [read, edit, write]
```

`workspace` 使用目标节点的绝对路径。支持 POSIX 和 Windows。项目 ID 在索引内唯一。`gitRemote` 可省略；支持网络 Git URL 和 SCP 风格地址。查询结果会移除登录信息、查询参数和片段。

`principals` 支持字符串 `'*'` 或所有者标识数组。空数组对所有人隐藏项目。每次查询与派发均检查相同授权。`permissions` 是 DSH 原生工具名列表，空数组表示不授予原生工具。编排器同时应用层级与父任务的权限上限。

## 宿主接口

- `ctx.prismRegistry.query(owner, search?)` 返回授权的元数据副本，可按项目、简介、技术栈、节点及 Git 远端检索。
- `ctx.prismRegistry.resolve(owner, id)` 返回含 `workspace` 的宿主记录。不可见和不存在的项目均抛出“项目不可用”。

`owner` 由编排器从经过认证的对话绑定取得。L1 工具只暴露查询，由编排器代入所有者。
