/* global console, URL */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'

const dist = new URL('../dist/', import.meta.url)
const html = readFileSync(new URL('index.html', dist), 'utf8')
const initial = [...new Set(Array.from(html.matchAll(/(?:src|href)="([^"]+\.js)"/g), m => m[1].replace(/^\//, '')))]
const gzip = file => gzipSync(readFileSync(new URL(file, dist))).length
assert.ok(initial.length > 0, 'missing build entry')
assert.ok(initial.every(file => !/RichTextEditor|Stats-/.test(file)), 'heavy private pages must remain lazy')
const initialSize = initial.reduce((sum, file) => sum + gzip(file), 0)
assert.ok(initialSize <= 150 * 1024, `initial JS exceeds 150KiB gzip: ${initialSize}`)
for (const [prefix, budget] of [['Home-', 15], ['Stats-', 180], ['RichTextEditor-', 450]]) {
  const files = readdirSync(new URL('assets/', dist)).filter(file => file.startsWith(prefix) && file.endsWith('.js'))
  assert.equal(files.length, 1, `expected one ${prefix} JS entry`)
  const file = 'assets/' + files[0], bytes = gzip(file)
  assert.ok(bytes <= budget * 1024, `${file} exceeds ${budget}KiB gzip: ${bytes}`)
  console.log(`${prefix} raw=${statSync(new URL(file, dist)).size} gzip=${bytes} budget=${budget * 1024}`)
}
console.log(`PASS initial JS gzip=${initialSize}, lazy route boundaries and bundle budgets`)
