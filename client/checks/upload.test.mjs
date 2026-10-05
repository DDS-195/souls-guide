/* global URL, AbortController, console */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
// Execute the component's actual script with isolated browser/API adapters; no network.
const source = readFileSync(new URL('../src/components/VideoUploader.vue', import.meta.url), 'utf8')
  .split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function fixture(api) {
  const events = [], messages = [], teardown = []
  const ctx = { AbortController, console, Promise, Error, Set, Math, ref: value => ({ value }),
    onUnmounted: f => teardown.push(f), defineOptions() {}, defineProps: () => ({ modelValue: null }),
    defineEmits: () => (...args) => events.push(args), toast: (...args) => messages.push(args),
    mediaApi: { removeAsset: async () => {}, ...api },
    SparkMD5: { ArrayBuffer: class { append() {} end() { return 'a'.repeat(32) } destroy() {} } },
    FileReader: class { readAsArrayBuffer() { Promise.resolve().then(() => this.onload({ target: { result: new ArrayBuffer(1) } })) } },
  }
  vm.createContext(ctx)
  vm.runInContext(ts.transpileModule(source + '\nglobalThis.check={upload,uploading};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, ctx)
  return { ...ctx.check, events, messages, teardown }
}
const file = { size: 25 * 1024 * 1024, name: 'test.mp4', slice() { return {} } }
let starts = 0, active = 0, merged = false
const failed = fixture({ videoStatus: async () => ({ data: { uploadedChunks: [] } }),
  videoChunk: async (_h, i, _t, _c, _n, signal) => {
    starts++; active++
    try {
      if (i === 0) throw new Error('first failure')
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      throw new Error('cancelled')
    } finally { active-- }
  }, videoMerge: async () => { merged = true } })
await failed.upload(file)
assert.equal(starts, 3)
assert.equal(active, 0)
assert.equal(merged, false)
assert.equal(failed.uploading.value, false)
assert.deepEqual(failed.events, [['busy', true], ['busy', false]])
assert.match(failed.messages[0][0], /first failure/)
const success = fixture({ videoStatus: async () => ({ data: { uploadedChunks: [] } }), videoChunk: async () => {}, videoMerge: async () => ({ data: { url: '/uploads/videos/test.mp4', asset_id: 1 } }) })
await success.upload(file)
assert.deepEqual(success.events, [['busy', true], ['update:modelValue', '/uploads/videos/test.mp4'], ['busy', false]])
console.log('PASS: failed upload aborts and drains workers; no merge after failure; busy brackets success and failure')
