// Produce a traceable snapshot without requiring a commit of unrelated local edits.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const root = path.resolve(__dirname, '..')
const id = process.argv[2]
if (!/^sg-\d{8}-[a-z0-9-]+$/.test(id || '')) throw Error('Invalid release id')
const files = []
function collect(relative) {
  const absolute = path.join(root, relative)
  if (fs.statSync(absolute).isDirectory()) {
    for (const entry of fs.readdirSync(absolute).sort()) collect(path.posix.join(relative, entry))
  } else files.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') })
}
for (const target of ['client/src', 'client/checks', 'client/package.json', 'client/package-lock.json', 'client/vite.config.ts',
  'server/src','server/db','server/test','server/server.js','server/package.json','server/package-lock.json','server/Dockerfile','server/Release.Dockerfile',
  'nginx','ops','docker-compose.yml','docker-compose.prod-http.yml']) collect(target)
const sourceSha256 = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex')
const frontend = fs.readdirSync(path.join(root, 'client/dist/assets')).filter(name => name.endsWith('.js')).sort().map(name => {
  const bytes = fs.readFileSync(path.join(root, 'client/dist/assets', name))
  return { name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
})
const manifest = { release: id, builtAt: new Date().toISOString(), node: process.version, sourceSha256, files, frontend }
const folder = path.join(root, '.artifacts'); fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(path.join(folder, 'release-manifest.json'), JSON.stringify(manifest, null, 2))
// Public manifest contains no secrets, account information or source listings.
fs.writeFileSync(path.join(root, 'client/dist/release.json'), JSON.stringify({ release: id, builtAt: manifest.builtAt, sourceSha256 }))
console.log(JSON.stringify({ release: id, sourceSha256, frontendFiles: frontend.length }))
