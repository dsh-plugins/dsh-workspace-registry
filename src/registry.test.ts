import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { messages } from './messages.js'
import { apply, ProjectRegistry, type ProjectEntry } from './index.js'

function project(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: 'mobile', description: '客户端', stack: ['TypeScript'],
    nodeId: 'laptop', workspace: '/srv/projects/mobile', principals: ['alice'],
    permissions: ['read', 'edit'],
    gitRemote: 'https://token:secret@git.example.test/team/mobile.git?password=secret#fragment',
    ...overrides,
  }
}

test('query exposes permitted metadata and strips private routing, ACL and credentials', () => {
  const registry = new ProjectRegistry([
    project(), project({ id: 'private', principals: ['bob'] }),
  ])
  assert.deepEqual(registry.query('alice', '客户端 TYPEScript'), [{
    id: 'mobile', description: '客户端', stack: ['TypeScript'], nodeId: 'laptop',
    gitRemote: 'https://git.example.test/team/mobile.git', permissions: ['read', 'edit'],
  }])
  assert.deepEqual(registry.query('alice', '/srv'), [])
  assert.deepEqual(registry.query('alice', 'secret'), [])
  assert.deepEqual(registry.query('alice', 'private'), [])
  assert.deepEqual(registry.query('nobody'), [])
  for (const id of ['private', 'missing']) {
    assert.throws(() => registry.resolve('alice', id), { message: messages.unavailable })
  }
  assert.equal(registry.resolve('alice', 'mobile').workspace, '/srv/projects/mobile')
})

test('input and returned snapshots cannot mutate the permissions, ACL or index', () => {
  const row = project()
  const registry = new ProjectRegistry([row])
  row.workspace = '/elsewhere'
  row.permissions.push('bash')
  ;(row.principals as string[]).push('mallory')
  registry.query('alice')[0].permissions.push('bash')
  registry.resolve('alice', 'mobile').stack.length = 0
  assert.deepEqual(registry.query('mallory'), [])
  assert.deepEqual(registry.query('alice')[0].permissions, ['read', 'edit'])
  assert.deepEqual(registry.query('alice')[0].stack, ['TypeScript'])
  assert.equal(registry.resolve('alice', 'mobile').workspace, '/srv/projects/mobile')
})

test('validates node-local path, duplicate ids, explicit ACLs and remote formats', () => {
  const registry = new ProjectRegistry([
    project({ workspace: 'D:\\users\\repo', gitRemote: 'git@git.example.test:team/repo.git', principals: '*' }),
  ])
  assert.equal(registry.resolve('bob', 'mobile').workspace, 'D:\\users\\repo')
  assert.equal(registry.query('bob')[0].gitRemote, 'ssh://git.example.test/team/repo.git')
  assert.deepEqual(registry.query(''), [])
  for (const bad of [
    { workspace: '../repo' }, { workspace: 'C:dir' }, { gitRemote: '/etc/private' },
    { gitRemote: 'file:///etc/private' }, { principals: undefined }, { permissions: undefined },
  ]) {
    assert.throws(() => new ProjectRegistry([project(bad)]))
  }
  assert.throws(() => new ProjectRegistry([project(), project()]))
})

test('Cordis service serves a persistent catalog snapshot after reload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'prism-registry-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'catalog.json')
  await writeFile(file, JSON.stringify([project()]))
  const ctx = new Context()
  await apply(ctx, { catalogFile: file })
  assert.equal(ctx.prismRegistry.resolve('alice', 'mobile').workspace, '/srv/projects/mobile')
  await writeFile(file, JSON.stringify([project({ principals: [] })]))
  const next = new Context()
  await apply(next, { catalogFile: file })
  assert.deepEqual(next.prismRegistry.query('alice'), [])
  await assert.rejects(apply(new Context(), { catalogFile: file, projects: [] }))
})

test('native settings changes authorize and revoke projects on the live registry', () => {
  let rows = [project({ principals: ['web:owner'], gitRemote: undefined })]
  const registry = new ProjectRegistry([], { get: () => rows })
  assert.deepEqual(registry.query('web:owner').map(p => p.id), ['mobile'])
  assert.deepEqual(registry.query('other'), [])
  rows = [project({ id: 'backend', workspace: '/srv/backend', principals: ['web:owner'] })]
  assert.throws(() => registry.resolve('web:owner', 'mobile'))
  assert.equal(registry.resolve('web:owner', 'backend').workspace, '/srv/backend')
  rows = []
  assert.deepEqual(registry.query('web:owner'), [])
})

test('a saved managed ID collision preserves the host grant and unrelated live projects', () => {
  const fixed = project({ id: 'mobile', principals: ['alice'], permissions: ['read'] })
  const duplicate = project({ id: 'mobile', workspace: '/other/mobile', principals: ['bob'], permissions: ['write'] })
  let rows = [duplicate, project({ id: 'backend', principals: ['bob'] })]
  const registry = new ProjectRegistry([fixed], { get: () => rows })
  assert.equal(registry.resolve('alice', 'mobile').workspace, fixed.workspace)
  assert.deepEqual(registry.resolve('alice', 'mobile').permissions, ['read'])
  assert.throws(() => registry.resolve('bob', 'mobile'))
  assert.deepEqual(registry.query('bob').map(p => p.id), ['backend'])
  rows = [project({ id: 'docs', principals: ['bob'] })]
  assert.deepEqual(registry.query('bob').map(p => p.id), ['docs'])
})

test('the DSH settings preflight rejects a new managed ID collision before persistence', async () => {
  const ctx = new Context()
  const { gitRemote: _remote, ...fixed } = project()
  await apply(ctx, { projects: [fixed] })
  assert.throws(() => ctx.fiber.resolveConfig({ projects: [fixed], managedProjects: [fixed] }), /mobile/)
  assert.doesNotThrow(() => ctx.fiber.resolveConfig({ projects: [fixed], managedProjects: [{ ...fixed, id: 'backend' }] }))
  assert.deepEqual(ctx.prismRegistry.query('alice').map(p => p.id), ['mobile'])
})
