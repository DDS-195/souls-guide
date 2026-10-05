/* global console, setTimeout, AbortController, URL */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { ref, computed, watch, reactive, nextTick } from 'vue'
const source = readFileSync(new URL('../src/views/MyLists.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm,'')
const route = reactive({ path:'/me/favorites', query:{} })
const calls=[], pending=[], disposed=[]
let ticket=0, controller=new AbortController()
const request = (kind,params,signal) => new Promise((resolve,reject)=>{ calls.push({kind,params,signal});pending.push({resolve,reject}) })
const context={ ref,computed,watch,onMounted(){},onScopeDispose:f=>disposed.push(f),
  useSelectionIndicator:()=>({style:ref({}),ready:ref(false),moving:ref(false)}),
  useRoute:()=>route,useRouter:()=>({}),useUserStore:()=>({userInfo:{id:42}}),
  useLatestRequest:()=>({next:()=>{controller.abort();controller=new AbortController();return ++ticket},isLatest:n=>n===ticket,signal:()=>controller.signal}),
  interactApi:{ getFavorites:(p,s)=>request('favorites',p,s),getFollowingFeed:(p,s)=>request('feed',p,s),getFollowing:(_id,p,s)=>request('authors',p,s) },
  gameApi:{getList:async()=>({data:[]})},postApi:{},historyKey:()=>'',localStorage:{getItem:()=>null} }
vm.createContext(context)
vm.runInContext(ts.transpileModule(source+'\nglobalThis.check={list,total,hasMore,loading,loadError,loadMore,reload};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context)
const c=context.check
const flush=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0))}
const result=(id,total=1)=>({data:{list:[{id,title:'攻略'}],total}})
assert.equal(calls[0].kind,'favorites')
route.query={game:'2'};await flush()
assert.equal(calls[1].params.game_id,2);assert.equal(calls[0].signal.aborted,true)
pending[1].resolve(result(2,2));await flush()
pending[0].resolve(result(1));await flush()
assert.equal(c.list.value[0].id,2);assert.equal(c.total.value,2)
c.loadMore();assert.equal(calls[2].params.page,2)
pending[2].reject(Error('network'));await flush();assert.ok(c.loadError.value);assert.equal(c.list.value.length,1)
c.loadMore();assert.equal(calls[3].params.page,2)
route.path='/me/following';route.query={view:'posts',game:'1'};await flush()
assert.equal(calls[4].kind,'feed');assert.equal(calls[4].params.page,1);assert.equal(calls[4].params.game_id,1)
assert.equal(c.list.value.length,0)
pending[4].resolve(result(4));pending[3].resolve(result(3));await flush();assert.equal(c.list.value[0].id,4)
route.query={};await flush();assert.equal(calls[5].kind,'authors')
pending[5].resolve(result(6));await flush();assert.equal(c.list.value[0].id,6);assert.equal(c.loading.value,false)
disposed.forEach(fn=>fn())
console.log('PASS: game/view routes reset pagination, abort old requests, stale responses ignored, failed append retries same page')
