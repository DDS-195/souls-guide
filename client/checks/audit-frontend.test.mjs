/* global URL, console, setTimeout, clearTimeout */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import { createPinia, defineStore } from 'pinia'
import { usePagination } from '../src/composables/usePagination.ts'
import { useLatestRequest } from '../src/composables/useLatestRequest.ts'
import { CATEGORIES, GUIDE_SECTIONS, emptyGuide, guideFrom, formatTime, parseChapters } from '../src/utils/guide.ts'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function script(path) {
  const text = source(path)
  return (text.includes('<script setup lang="ts">') ? text.split('<script setup lang="ts">')[1].split('</script>')[0] : text)
    .replace(/^import .*$/gm, '')
    .replace(/^export default .*$/gm, '')
    .replace(/^export /gm, '')
}
function run(code, context, exports) {
  vm.createContext(context)
  const scope = effectScope()
  scope.run(() => vm.runInContext(ts.transpileModule(code + `\nglobalThis.check={${exports}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context))
  return { ...context.check, stop: () => scope.stop() }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => setImmediate()
const identity = (id = 42) => ({
  id, username: `player${id}`, role: 'creator', status: 1,
  nickname: '玩家', avatar: null, bio: '', gender: '', birthday: '', apply_status: 'approved',
})

function identityFixture() {
  const storage = new Map(), calls = []
  const api = { getMe: () => {
    const pending = deferred()
    calls.push(pending)
    return pending.promise
  } }
  const context = {
    ref, computed, defineStore,
    safeStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { cookie: '' }, loadApi: async () => ({ userApi: api }),
  }
  const loaded = run(script('../src/stores/user.ts').replaceAll("await import('../api')", 'await loadApi()'), context, 'useUserStore')
  const store = loaded.useUserStore(createPinia())
  return { store, calls, stop: () => { store.$dispose(); loaded.stop() } }
}

// A valid token without a full /me identity is not a ready private-page session.
const auth = identityFixture()
auth.store.setToken('session-a')
auth.store.userInfo = { username: 'legacy', role: 'creator' }
const restoring = auth.store.ensureUserInfo()
assert.equal(auth.store.ensureUserInfo(), restoring, 'concurrent recovery shares one request')
await flush()
assert.equal(auth.calls.length, 1)
auth.calls[0].resolve({ data: identity() })
await restoring
assert.equal(auth.store.userInfo.id, 42)
auth.store.setToken('session-b')
assert.equal(auth.store.userInfo, null, 'changing accounts clears the previous identity')
const stale = auth.store.ensureUserInfo()
const staleRejected = assert.rejects(stale, /登录账号已变化/)
await flush()
auth.store.logout()
auth.calls[1].resolve({ data: identity(43) })
await staleRejected
assert.equal(auth.store.userInfo, null, 'late /me cannot repopulate a logged-out store')
auth.store.setToken('session-c')
const incomplete = auth.store.ensureUserInfo()
const incompleteRejected = assert.rejects(incomplete, /用户资料不完整/)
await flush()
auth.calls[2].resolve({ data: { username: 'partial', role: 'creator' } })
await incompleteRejected
assert.equal(auth.store.userInfo, null)

// A failed /me keeps the token on the login page and retries /me, not another login.
let loginCount = 0
const navigations = [], loginUnmount = []
const login = run(script('../src/views/Login.vue'), {
  ref, onBeforeUnmount: fn => loginUnmount.push(fn),
  useUserStore: () => auth.store,
  useRoute: () => ({ query: { redirect: '/me/favorites' } }),
  useRouter: () => ({ push: path => navigations.push(path) }),
  userApi: { login: async () => { loginCount++; return { data: { token: 'login-session' } } } },
  errorMessage: (_error, fallback) => fallback,
}, 'handleLogin,form,errMsg,pendingSession')
// This fixture started with an incomplete restored session: the button only retries its profile.
const failedLogin = login.handleLogin()
await flush()
auth.calls[3].reject(Error('temporary network'))
await failedLogin
assert.equal(loginCount, 0)
assert.equal(auth.store.token, 'session-c')
assert.equal(auth.store.userInfo, null)
assert.equal(navigations.length, 0)
assert.match(login.errMsg.value, /重试加载资料/)
const retry = login.handleLogin()
await flush()
auth.calls[4].resolve({ data: identity() })
await retry
assert.equal(loginCount, 0)
assert.equal(navigations[0], '/me/favorites')
loginUnmount.forEach(fn => fn())
login.stop()

// The route guard also blocks partial identities and discards recovery from a replaced session.
let guard
const guardAuth = identityFixture()
guardAuth.store.setToken('guard-session')
const guardRoutes = []
const routerContext = {
  createWebHistory: () => ({}),
  createRouter: () => ({ beforeEach: fn => { guard = fn } }),
  useUserStore: () => guardAuth.store, toast() {},
}
const routerCheck = run(script('../src/router/index.ts'), routerContext, 'router')
const navigating = guard({ meta: { auth: true }, fullPath: '/me/favorites' }, {}, value => guardRoutes.push(value))
await flush()
guardAuth.calls[0].reject(Error('temporary network'))
await navigating
assert.equal(guardRoutes[0].path, '/login')
assert.equal(guardRoutes[0].query.redirect, '/me/favorites')
assert.equal(guardAuth.store.token, 'guard-session')
const secondNavigation = guard({ meta: { auth: true }, fullPath: '/creator/write' }, {}, value => guardRoutes.push(value))
await flush()
guardAuth.store.setToken('replaced-session')
guardAuth.calls[1].resolve({ data: identity() })
await secondNavigation
assert.equal(guardRoutes.at(-1), false)
assert.equal(guardAuth.store.userInfo, null)
routerCheck.stop(); guardAuth.stop(); auth.stop()

function writingFixture() {
  const store = reactive({ token: 'writer-session', userInfo: { id: 42 } })
  const uploads = [], removed = [], creates = [], messages = [], unmount = []
  const context = {
    ref, computed, watch, setTimeout, clearTimeout,
    useRouter: () => ({ push() {} }), useRoute: () => ({ params: {} }), useUserStore: () => store,
    defineAsyncComponent: () => ({}), onMounted() {}, onUnmounted: fn => unmount.push(fn), onBeforeRouteLeave() {}, onBeforeRouteUpdate() {},
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => false },
    gameApi: { getList: async () => ({ data: [{ id: 1, status: 1 }] }) },
    postApi: { create: async payload => { creates.push(payload); return { data: { id: 9, status: 'draft', content_version: 1 } } } },
    mediaApi: { uploadImage: file => {
      const pending = deferred(); uploads.push({ ...pending, file }); return pending.promise
    }, removeAsset: async id => removed.push(id) },
    compressImage: async file => file, toast: (...args) => messages.push(args),
    draftKey: () => '', readWritingDraft: () => null, storeWritingDraft: () => true, removeWritingDraft() {}, createRequestId: () => 'request-id-0123456789',
    CATEGORIES, GUIDE_SECTIONS, emptyGuide, guideFrom, formatTime, parseChapters,
  }
  const check = run(script('../src/views/creator/Write.vue'), context, 'initEditor,uploadCover,removeCover,coverUrl,coverUploading,save,form,richReady')
  const pick = name => check.uploadCover({ target: { files: [{ name }], value: name } })
  const close = () => { unmount.forEach(fn => fn()); check.stop() }
  return { ...check, pick, close, store, uploads, removed, creates, messages }
}
const cover = writingFixture()
await cover.initEditor()
cover.richReady.value = true
cover.form.value.title = '攻略'; cover.form.value.content = '<p>正文</p>'
const firstCover = cover.pick('A'); await flush()
const lastCover = cover.pick('B'); await flush()
cover.uploads[1].resolve({ data: { url: '/uploads/B.webp', asset_id: 2 } })
await lastCover
assert.equal(cover.coverUrl.value, '/uploads/B.webp')
assert.equal(cover.coverUploading.value, true, 'older upload still blocks save')
await cover.save('draft')
assert.equal(cover.creates.length, 0)
cover.uploads[0].resolve({ data: { url: '/uploads/A.webp', asset_id: 1 } })
await firstCover
assert.equal(cover.coverUrl.value, '/uploads/B.webp', 'latest selection wins, not latest response')
assert.deepEqual(cover.removed, [1])
assert.equal(cover.coverUploading.value, false)
await cover.save('draft')
assert.equal(cover.creates[0].cover, '/uploads/B.webp')
cover.close()

for (const action of ['remove', 'unmount', 'session-change']) {
  const fixture = writingFixture()
  await fixture.initEditor()
  const uploading = fixture.pick(action)
  await flush()
  if (action === 'remove') await fixture.removeCover()
  if (action === 'unmount') fixture.close()
  if (action === 'session-change') fixture.store.token = 'new-account'
  fixture.uploads[0].resolve({ data: { url: '/uploads/late.webp', asset_id: 77 } })
  await uploading
  assert.equal(fixture.coverUrl.value, null, `late upload cannot undo ${action}`)
  assert.equal(fixture.messages.length, 0)
  assert.deepEqual(fixture.removed, action === 'session-change' ? [] : [77], 'only the original session may clean its temporary asset')
  if (action !== 'unmount') fixture.close()
}

function listFixture(path, apiName) {
  const calls = []
  const api = { [apiName]: params => {
    const pending = deferred(); calls.push({ ...pending, params }); return pending.promise
  } }
  const context = { ref, onMounted() {}, usePagination, useLatestRequest,
    useRouter: () => ({ push() {} }), adminApi: api, postApi: api, toast() {}, errorMessage: (_error, fallback) => fallback }
  return { ...run(script(path), context, path.includes('Reports') ? 'load,switchTab,tab,list,loading' : 'load,goPage,page,total,posts,loading'), calls }
}
const reports = listFixture('../src/views/admin/Reports.vue', 'getReports')
const oldReports = reports.load()
reports.switchTab('resolved')
reports.calls[1].resolve({ data: { list: [{ id: 2, status: 'resolved' }], total: 1 } })
await flush()
reports.calls[0].resolve({ data: { list: [{ id: 1, status: 'pending' }], total: 1 } })
await oldReports
assert.equal(reports.tab.value, 'resolved')
assert.equal(reports.list.value[0].status, 'resolved')
assert.equal(reports.loading.value, false)
assert.match(source('../src/views/admin/Reports.vue'), /<AppEmpty v-if="loading \|\| error \|\| !list\.length"/)
const disposedReport = reports.load()
reports.stop()
reports.calls[2].resolve({ data: { list: [{ id: 3, status: 'resolved' }], total: 1 } })
await disposedReport
assert.equal(reports.list.value[0].id, 2)

const works = listFixture('../src/views/creator/MyPosts.vue', 'getMyList')
works.total.value = 40
const oldWorks = works.load()
works.goPage(2)
works.calls[1].resolve({ data: { list: [{ id: 20 }], total: 40 } })
await flush()
works.calls[0].resolve({ data: { list: [{ id: 10 }], total: 40 } })
await oldWorks
assert.equal(works.page.value, 2)
assert.equal(works.posts.value[0].id, 20)
works.stop()

function profileFixture() {
  const store = reactive({ token: 'profile-session', userInfo: identity() }), calls = [], unmount = []
  const check = run(script('../src/views/EditProfile.vue'), {
    ref, onMounted() {}, onBeforeUnmount: fn => unmount.push(fn), useUserStore: () => store, useRouter: () => ({}),
    userApi: { updateProfile: payload => {
      const pending = deferred(); calls.push({ ...pending, payload: { ...payload } }); return pending.promise
    } }, mediaApi: {}, errorMessage: (_error, fallback) => fallback,
  }, 'save,form,msg')
  return { ...check, store, calls, close: () => { unmount.forEach(fn => fn()); check.stop() } }
}
const profile = profileFixture()
profile.form.value.nickname = '提交值 A'
const saving = profile.save()
await profile.save()
assert.equal(profile.calls.length, 1, 'double click cannot send a second profile update')
profile.form.value.nickname = '新修改 B'
profile.calls[0].resolve({ data: null })
await saving
assert.equal(profile.calls[0].payload.nickname, '提交值 A')
assert.equal(profile.store.userInfo.nickname, '提交值 A')
assert.equal(profile.form.value.nickname, '新修改 B')
assert.match(profile.msg.value, /新修改尚未保存/)
profile.close()
const changedProfile = profileFixture()
changedProfile.form.value.nickname = 'old-account-update'
const changedSaving = changedProfile.save()
changedProfile.store.token = 'other-session'; changedProfile.store.userInfo = identity(43)
changedProfile.calls[0].resolve({ data: null })
await changedSaving
assert.equal(changedProfile.store.userInfo.nickname, '玩家')
assert.equal(changedProfile.msg.value, '')
changedProfile.close()
console.log('PASS: complete identity recovery, login retry, route/session guards, latest cover selection and full upload lifetime, late cover cleanup, list races/unmount, correct empty states, profile save snapshot')
