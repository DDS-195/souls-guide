const fs = require('fs')
const path = require('path')
const H = require('./helpers')

const ROUTE_MOUNTS = {
  'users.js': '/api/users',
  'games.js': '/api/games',
  'posts.js': '/api/posts',
  'interact.js': '/api',
  'admin.js': '/api/admin',
  'announcements.js': '/api/announcements',
  'media.js': '/api/media',
  'creator.js': '/api/creator',
}

function normalizeExpressPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function implementationOperations() {
  const operations = new Set()
  for (const [filename, mount] of Object.entries(ROUTE_MOUNTS)) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', filename), 'utf8')
    const routePattern = /router\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g
    for (const match of source.matchAll(routePattern)) {
      const suffix = match[2] === '/' ? '' : match[2]
      operations.add(`${match[1].toUpperCase()} ${normalizeExpressPath(mount + suffix)}`)
    }
  }
  return operations
}

function contractOperations() {
  const contractPath = path.join(__dirname, '..', '..', 'docs', 'openapi.json')
  const document = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
  const operations = new Set()
  for (const [routePath, item] of Object.entries(document.paths)) {
    const resolved = item.$ref
      ? item.$ref.split('/').slice(1).reduce((value, key) => value[key], document)
      : item
    for (const method of ['get', 'post', 'put', 'delete']) {
      if (resolved[method]) operations.add(`${method.toUpperCase()} ${routePath}`)
    }
  }
  return operations
}

module.exports = async function contractSuite() {
  console.log('\n[00] OpenAPI 路由契约')
  await H.test('OpenAPI 与 Express 路由 method/path 双向一致', async () => {
    const implementation = implementationOperations()
    const contract = contractOperations()
    H.assert.deepEqual([...contract].sort(), [...implementation].sort())
  })
}
