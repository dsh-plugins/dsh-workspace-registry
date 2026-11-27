import { messages } from './messages.js'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { normalize, posix, win32 } from 'node:path'

/** Fields the project's operators have made available to an authorized L1. */
export interface ProjectMetadata {
  id: string
  description: string
  stack: string[]
  nodeId: string
  gitRemote?: string
  permissions: string[]
}

/** A workspace path is only meaningful on its assigned node. */
export interface ResolvedProject extends ProjectMetadata {
  workspace: string
  workspaceId?: string
}

export interface ProjectEntry extends ResolvedProject {
  principals: '*' | string[]
}

/** 明确启用 DSH 工作区发现，独立宿主继续读取配置目录。 */
export interface Config {
  projects?: ProjectEntry[]
  catalogFile?: string
  useHostWorkspaces?: boolean
}

interface NativeWorkspace {
  id: string
  path: string
  title: string
}

interface NativeWorkspaceCatalog {
  nodeId: string
  list(): readonly NativeWorkspace[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    prismRegistry: ProjectRegistry
  }
}

const identifier = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u

const nativeTools = ['read', 'glob', 'grep']

export const Config = z.object({
  projects: z.any(),
  catalogFile: z.string(),
  useHostWorkspaces: z.boolean(),
})

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(messages.fieldText.replace('{field}', () => field))
  }
  return value
}

function key(value: unknown, field: string): string {
  const text = requiredText(value, field)
  if (!identifier.test(text)) throw new Error(messages.invalidField.replace('{field}', () => field))
  return text
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(messages.fieldArray.replace('{field}', () => field))
  return [...new Set(value.map(item => requiredText(item, field)))]
}

function publicRemote(value: unknown): string {
  const raw = requiredText(value, 'gitRemote')
  // Git also accepts SCP syntax. Do not expose its login component.
  const scp = !raw.includes('://') && /^(?:[a-zA-Z0-9._-]+@)?([a-zA-Z0-9.-]+):([\w./~-]+)$/.exec(raw)
  const url = scp && !/^[A-Za-z]:/.test(raw)
    ? URL.parse(`ssh://${scp[1]}/${scp[2]}`)
    : URL.parse(raw)
  if (!url || !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !url.hostname) {
    throw new Error(messages.remote)
  }
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString()
}

function parseProject(raw: unknown): ProjectEntry {
  if (typeof raw !== 'object' || !raw || Array.isArray(raw)) throw new Error(messages.entry)
  const row = raw as Record<string, unknown>
  const workspace = requiredText(row.workspace, 'workspace')
  // Accept paths for other operating systems when reading a multi-node catalog.
  if (!posix.isAbsolute(workspace) &&
      !(win32.isAbsolute(workspace) && (/^[A-Za-z]:/.test(workspace) || workspace.startsWith('\\\\')))) {
    throw new Error(messages.absolute)
  }
  const permissions = textList(row.permissions, 'permissions').map(tool => key(tool, 'permissions'))
  const principals = row.principals === '*' ? '*' : textList(row.principals, 'principals')
  if (principals !== '*' && principals.includes('*')) throw new Error(messages.wildcard)
  return {
    id: key(row.id, 'id'),
    description: requiredText(row.description, 'description'),
    stack: textList(row.stack, 'stack'),
    nodeId: key(row.nodeId, 'nodeId'),
    workspace,
    principals,
    permissions,
    ...(row.gitRemote === undefined ? {} : { gitRemote: publicRemote(row.gitRemote) }),
  }
}

function visibleTo(project: ProjectEntry, owner: string): boolean {
  return typeof owner === 'string' && owner.trim().length > 0 &&
    (project.principals === '*' || project.principals.includes(owner))
}

function metadata(project: ResolvedProject): ProjectMetadata {
  return {
    id: project.id,
    description: project.description,
    stack: [...project.stack],
    nodeId: project.nodeId,
    permissions: [...project.permissions],
    ...(project.gitRemote === undefined ? {} : { gitRemote: project.gitRemote }),
  }
}

function indexProjects(entries: readonly unknown[]) {
  const index = new Map<string, ProjectEntry>()
  for (const entry of entries) {
    const project = parseProject(entry)
    if (index.has(project.id)) throw new Error(messages.duplicate.replace('{id}', () => project.id))
    index.set(project.id, project)
  }
  return index
}

function localWorkspacePath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
      return normalize(path)
    }
    throw error
  }
}

/** 合并显式项目条目与宿主提供的本地工作区，按会话身份限制访问。 */
export class ProjectRegistry {
  private readonly projects: Map<string, ProjectEntry>

  constructor(entries: readonly ProjectEntry[], private readonly native?: () => NativeWorkspaceCatalog | undefined) {
    if (!Array.isArray(entries)) {
      throw new Error(messages.entries)
    }
    this.projects = indexProjects(entries)
  }

  private hostProjects(owner: string): ResolvedProject[] {
    const native = this.native?.()
    if (!native || (owner !== 'web:owner' && !owner.startsWith('im:'))) {
      return []
    }

    // 显式项目的权限同样约束已附加到 DSH 的路径，避免工作区发现绕过授权。
    const configuredPaths = new Set([...this.projects.values()]
      .filter(project => project.nodeId === native.nodeId)
      .map(project => localWorkspacePath(project.workspace)))
    return native.list()
      .filter(workspace => !this.projects.has(workspace.id) && !configuredPaths.has(workspace.path))
      .map(workspace => ({
        id: workspace.id,
        description: workspace.title.trim() || workspace.id,
        stack: [],
        nodeId: native.nodeId,
        permissions: [...nativeTools],
        workspace: workspace.path,
        workspaceId: workspace.id,
      }))
  }

  query(owner: string, search = ''): ProjectMetadata[] {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const configured = [...this.projects.values()].filter(project => visibleTo(project, owner))
    return [...configured, ...this.hostProjects(owner)].filter(project => {
      const fields = [project.id, project.description, ...project.stack, project.nodeId, project.gitRemote ?? '']
      const text = fields.join(' ').toLowerCase()
      return terms.every(term => text.includes(term))
    }).map(metadata)
  }

  /** 按当前身份解析派发路径，Mesh 仅接受显式项目。 */
  resolve(owner: string, projectId: string, source?: 'configured'): ResolvedProject {
    const configured = this.projects.get(projectId)
    if (configured && visibleTo(configured, owner)) {
      return { ...metadata(configured), workspace: configured.workspace }
    }
    if (!configured && source !== 'configured') {
      const workspace = this.hostProjects(owner).find(project => project.id === projectId)
      if (workspace) {
        return workspace
      }
    }
    throw new Error(messages.unavailable)
  }
}

export const name = 'dsh-workspace-registry'

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.catalogFile !== undefined && config.projects !== undefined) {
    throw new Error(messages.source)
  }
  const entries = config.catalogFile === undefined
    ? (config.projects === undefined ? [] : config.projects)
    : JSON.parse(await readFile(requiredText(config.catalogFile, 'catalogFile'), 'utf8'))

  let native: NativeWorkspaceCatalog | undefined
  if (config.useHostWorkspaces) {
    ctx.inject(['workspaceRegistry', 'dshMesh'], scope => {
      const workspaces = scope.get('workspaceRegistry', true) as Pick<NativeWorkspaceCatalog, 'list'>
      const { nodeId } = scope.get('dshMesh', true) as Pick<NativeWorkspaceCatalog, 'nodeId'>
      native = { nodeId, list: () => workspaces.list() }
      return () => { native = undefined }
    })
  }
  ctx.provide('prismRegistry', new ProjectRegistry(entries, () => native))
}
