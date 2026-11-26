import { messages } from './messages.js'
import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

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
}

export interface ProjectEntry extends ResolvedProject {
  principals: '*' | string[]
}

export interface Config {
  projects?: ProjectEntry[]
  catalogFile?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    prismRegistry: ProjectRegistry
  }
}

const identifier = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u

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

function metadata(project: ProjectEntry): ProjectMetadata {
  return {
    id: project.id,
    description: project.description,
    stack: [...project.stack],
    nodeId: project.nodeId,
    permissions: [...project.permissions],
    ...(project.gitRemote === undefined ? {} : { gitRemote: project.gitRemote }),
  }
}

export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectEntry>()

  constructor(entries: readonly ProjectEntry[]) {
    if (!Array.isArray(entries)) throw new Error(messages.entries)
    for (const entry of entries) {
      const project = parseProject(entry)
      if (this.projects.has(project.id)) throw new Error(messages.duplicate.replace('{id}', () => project.id))
      this.projects.set(project.id, project)
    }
  }

  query(owner: string, search = ''): ProjectMetadata[] {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return [...this.projects.values()].filter(project => {
      if (!visibleTo(project, owner)) return false
      const fields = [project.id, project.description, ...project.stack, project.nodeId, project.gitRemote ?? '']
      const text = fields.join(' ').toLowerCase()
      return terms.every(term => text.includes(term))
    }).map(metadata)
  }

  /** Host-only. Inaccessible and missing IDs have the same public error. */
  resolve(owner: string, projectId: string): ResolvedProject {
    const project = this.projects.get(projectId)
    if (!project || !visibleTo(project, owner)) throw new Error(messages.unavailable)
    return { ...metadata(project), workspace: project.workspace }
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
  ctx.provide('prismRegistry', new ProjectRegistry(entries))
}
