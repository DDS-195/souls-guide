/* global console, URL */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref, computed } from 'vue'
import { createSafeStorage } from '../src/utils/storage.ts'

const values = new Map([['token', 'old']])
let blocked = false
const storage = createSafeStorage(() => ({
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { if (blocked) throw Error('quota'); values.set(key, value) },
  removeItem: key => { if (blocked) throw Error('blocked'); values.delete(key) },
}))
blocked = true
assert.equal(storage.setItem('token', 'new'), false)
assert.equal(storage.getItem('token'), 'new')
assert.equal(storage.removeItem('token'), false)
blocked = false
assert.equal(storage.getItem('token'), null, 'logout tombstone cannot restore stale persisted token')
assert.equal(storage.setItem('token', 'fresh'), true)
assert.equal(storage.getItem('token'), 'fresh')
const denied = createSafeStorage(() => { throw Error('SecurityError') })
assert.equal(denied.getItem('token'), null)
denied.setItem('visitor', 'stable'); assert.equal(denied.getItem('visitor'), 'stable')
denied.removeItem('visitor'); assert.equal(denied.getItem('visitor'), null)

const source = readFileSync(new URL('../src/views/Register.vue', import.meta.url), 'utf8')
let finish, calls = 0
const unmount = [], navigations = []
const context = { ref, onBeforeUnmount: fn => unmount.push(fn),
  useRouter: () => ({ push: route => navigations.push(route) }), useRoute: () => ({ query: {} }),
  userApi: { register: () => { calls++; return new Promise(resolve => { finish = resolve }) } },
  errorMessage: () => 'failed',
}
vm.createContext(context)
const code = source.split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
vm.runInContext(ts.transpileModule(code + '\nglobalThis.test={form,handleRegister};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
context.test.form.value = { username: 'player', password: 'secret123', confirmPassword: 'secret123' }
const pending = context.test.handleRegister()
await context.test.handleRegister(); assert.equal(calls, 1, 'rapid repeated submit calls register once')
unmount.forEach(fn => fn()); finish(); await pending
assert.equal(navigations.length, 0, 'leaving registration prevents late navigation')
for (const page of ['Login', 'Register']) {
  const template = readFileSync(new URL(`../src/views/${page}.vue`, import.meta.url), 'utf8')
  assert.match(template, /<form[^>]+@submit.prevent=/)
  assert.match(template, /autocomplete="username"/)
  assert.match(template, /<label[^>]+for=/)
}
console.log('PASS storage fallback, registration single-flight, lifecycle and form semantics')
const profileSource = readFileSync(new URL('../src/views/UserProfile.vue', import.meta.url), 'utf8')
const seq = ref(0)
let profileFailure = 500
const profileContext = { ref, computed, watch: () => {}, onMounted: () => {}, onUnmounted: () => {},
  useRoute: () => ({ params: { id: '5' } }), useRouter: () => ({ push: () => {} }),
  useUserStore: () => ({ token: '', userInfo: null }),
  useLatestRequest: () => ({ seq, next: () => ++seq.value, isLatest: ticket => ticket === seq.value }),
  userApi: { getProfile: async () => { if (profileFailure) throw { response: { status: profileFailure } }; return { data: { id: 5 } } } },
  postApi: { getList: async () => { throw Error('network') } },
  errorMessage: (_error, fallback) => fallback, toast: () => {},
}
vm.createContext(profileContext)
vm.runInContext(ts.transpileModule(profileSource.split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm, '') + '\nglobalThis.test={load,loadPosts,notFound,loadError,postsError,posts};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, profileContext)
await profileContext.test.load(5)
assert.equal(profileContext.test.notFound.value, false)
assert.match(profileContext.test.loadError.value, /重试/)
profileFailure = 0; await profileContext.test.load(5); await profileContext.test.loadPosts(5)
assert.equal(profileContext.test.loadError.value, '')
assert.match(profileContext.test.postsError.value, /重试/)
profileFailure = 404; await profileContext.test.load(5)
assert.equal(profileContext.test.notFound.value, true)
assert.equal(profileContext.test.loadError.value, '')
console.log('PASS profile 500 versus 404, successful retry and visible post-list errors')
