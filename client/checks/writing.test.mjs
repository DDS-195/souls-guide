/* global URL, console, setTimeout, clearTimeout */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { ref, computed, watch, nextTick } from 'vue'
import { webcrypto } from 'node:crypto'
import { CATEGORIES, GUIDE_SECTIONS, emptyGuide, guideFrom, formatTime, parseChapters } from '../src/utils/guide.ts'
import { draftKey, readWritingDraft, storeWritingDraft, removeWritingDraft } from '../src/utils/writingDraft.ts'
const values = new Map()
globalThis.localStorage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
const script = readFileSync(new URL('../src/views/creator/Write.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function fixture({ id, api = {} } = {}) {
  const messages = [], lifecycle = [], leaves = [], navigations = []
  const ctx = { console, setTimeout, clearTimeout, ref, computed, watch, nextTick,
    useRouter: () => ({ push: url => navigations.push(url) }), useRoute: () => ({ params: id ? { id } : {} }),
    useUserStore: () => ({ token: 'same-session', userInfo: { id: 42 } }),
    defineAsyncComponent: () => ({}), onMounted() {}, onUnmounted: f => lifecycle.push(f),
    onBeforeRouteLeave: f => leaves.push(f), onBeforeRouteUpdate() {},
    window: { innerWidth: 390, addEventListener() {}, removeEventListener() {}, confirm: () => false },
    gameApi: { getList: async () => ({ data: [{ id: 1, name: '游戏', status: 1 }] }) },
    postApi: api, mediaApi: {}, toast: (...args) => messages.push(args),
    draftKey, readWritingDraft, storeWritingDraft, removeWritingDraft, createRequestId: () => webcrypto.randomUUID(),
    CATEGORIES, GUIDE_SECTIONS, emptyGuide, guideFrom, formatTime, parseChapters,
  }
  vm.createContext(ctx)
  vm.runInContext(ts.transpileModule(script + '\nglobalThis.check={initEditor,save,form,guide,chapterText,savedId,contentVersion,videoUploading,editorUploading,richReady,persistDraft,restoreDraft,recoverable,conflictMessage};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, ctx)
  return { ...ctx.check, messages, leaves, navigations, close: () => lifecycle.forEach(f => f()) }
}
let creates = 0, requests = [], updates = []
const a = fixture({ api: { create: async body => {
  creates++; requests.push(body)
  if (creates === 1) throw new Error('response lost')
  return { data: { id: 9, content_version: 1, status: 'draft', replayed: true } }
}, update: async (_id, body) => { updates.push(body); return { data: { status: 'draft', content_version: 2 } } } } })
await a.initEditor()
a.form.value.title = '原稿'; a.form.value.content = '<p>原稿</p>'
a.guide.value.summary = '原结论'
await a.save('draft'); assert.equal(creates, 0) // Editor has not initialized: no unsafe save.
a.richReady.value = true
a.editorUploading.value = true; await a.save('draft'); assert.equal(creates, 0)
a.editorUploading.value = false
a.videoUploading.value = true; await a.save('draft'); assert.equal(creates, 0)
a.videoUploading.value = false; await a.save('draft'); assert.equal(creates, 1)
assert.equal(a.leaves[0](), false)
const saved = readWritingDraft(draftKey(42, 'new'))
assert.equal(saved.pendingCreate.payload.title, '原稿')
const b = fixture({ api: { create: async body => { requests.push(body); return { data: { id: 9, content_version: 1, status: 'draft', replayed: true } } }, update: async (_id, body) => { updates.push(body); return { data: { status: 'draft', content_version: 2 } } } } })
await b.initEditor(); b.richReady.value = true; assert.ok(b.recoverable.value); b.restoreDraft()
assert.equal(b.guide.value.summary, '原结论')
b.guide.value.summary = '更新结论'
b.form.value.title = '重试前修改'; await b.save('draft')
assert.equal(requests[0].request_id, requests[1].request_id)
assert.equal(requests[1].title, '原稿')
assert.equal(updates[0].title, '重试前修改')
assert.equal(updates[0].content_version, 1)
assert.equal(requests[1].guide_info.summary, '原结论')
assert.equal(updates[0].guide_info.summary, '更新结论')
assert.equal(b.savedId.value, 9)
assert.equal(b.navigations[0], '/creator/posts')
assert.equal(readWritingDraft(draftKey(42, 'new')), null)
const c = fixture({ id: '9', api: { getManageDetail: async () => ({ data: { title: '原稿', content: '正文', game_id: 1, category: '新手入门', tags: [], media: [], cover: null, status: 'draft', content_version: 3 } }), update: async (_id, body) => {
  assert.equal(body.content_version, 3); throw { response: { status: 409, data: { message: '版本冲突' } } }
} } })
await c.initEditor(); c.richReady.value = true; c.form.value.title = '我的修改'; await c.save('draft')
assert.equal(c.form.value.title, '我的修改'); assert.equal(c.conflictMessage.value, '版本冲突')
assert.equal(readWritingDraft(draftKey(42, '9')).form.title, '我的修改')
assert.equal(readWritingDraft(draftKey(43, '9')), null)
let submittedPublished = 0
const published = fixture({ id: '10', api: {
  getManageDetail: async () => ({ data: { title: '已发布', content: '旧正文', game_id: 1, category: '新手入门', tags: [], media: [], cover: null, status: 'published', content_version: 1 } }),
  update: async (_id, body) => {
    assert.equal(body.content_version, 1)
    return { data: { status: 'pending', content_version: 2, is_revision: true, public_status: 'published' } }
  }, submit: async () => { submittedPublished++ },
} })
await published.initEditor(); published.richReady.value = true
published.form.value.content = '新版正文'; await published.save('pending')
assert.equal(submittedPublished, 0)
assert.equal(published.contentVersion.value, 2)
assert.equal(published.navigations[0], '/creator/posts')
assert.match(published.messages[0][0], /等待审核/)
a.close(); b.close(); c.close(); published.close()
console.log('PASS: upload blocks save, failed creation survives reload with same key, modified text updates same post, conflict retains text and account isolation')
