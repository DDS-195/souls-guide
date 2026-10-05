/* global console, URL, URLSearchParams */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref, computed, reactive, watch, nextTick } from 'vue'
import { homeLayout } from '../src/utils/homeLayout.ts'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
for (let width = 320; width <= 3840; width++) {
  const client = width - (width >= 768 ? 17 : 0)
  const available = client - (width < 768 ? 28 : width < 1200 ? 252 : 284)
  const layout = homeLayout(width, client, available)
  assert.equal(layout.pageSize % layout.columns, 0, 'incomplete row at ' + width)
  assert.ok(layout.columns >= 1 && layout.columns <= 6)
  assert.ok(layout.pageSize >= 15 && layout.pageSize <= 18)
  const imageWidth = Number.parseFloat(layout.imageSizes)
  assert.ok((imageWidth + 2) * layout.columns + layout.gap * (layout.columns - 1) <= available + .001)
  if (width >= 768) assert.ok(imageWidth >= (width < 1200 ? 238 : 258))
}
assert.equal(homeLayout(950, 933).columns, 2)
assert.equal(homeLayout(950, 933).pageSize, 16)
assert.equal(homeLayout(1920, 1903).columns, 5)
assert.equal(homeLayout(1920, 1903).pageSize, 15)
assert.equal(homeLayout(2560, 2543).pageSize, 18)
assert.equal(homeLayout(1920, 1903, 650).columns, 2, 'measured container overrides window estimate')

const home = read('../src/views/Home.vue')
const route = reactive({fullPath:'/',query:{}})
const calls = [], navigations = [], frames = [], watchers = [], scrolls = []
const rows = Array.from({length:36},(_,index)=>({id:index+1,game_id:index<2?8:1,title:'攻略 '+(index+1)}))
const resolve = options => {
  const query = new URLSearchParams(Object.entries(options.query).filter(([,v])=>v!==undefined)).toString()
  return {fullPath:'/' + (query ? '?' + query : '')}
}
const navigate = options => {
  navigations.push(options)
  route.query = options.query
  route.fullPath = resolve(options).fullPath
  return Promise.resolve()
}
let ticket = 0, deferredRequest
const context = {
  ref,computed,nextTick,watch:(...args)=>{const stop=watch(...args);watchers.push(stop);return stop},
  onMounted:()=>{},onUnmounted:()=>{},onBeforeRouteLeave:()=>{},
  requestAnimationFrame:callback=>{frames.push(callback);return frames.length},cancelAnimationFrame:()=>{},
  window:{innerWidth:1920,scrollY:600,scrollTo:options=>scrolls.push(options)},document:{documentElement:{clientWidth:1903}},
  homeLayout,useRoute:()=>route,useRouter:()=>({push:navigate,replace:navigate,resolve}),
  useSelectionIndicator:()=>({}),useHorizontalDrag:()=>({}),CATEGORIES:['新手入门'],
  useLatestRequest:()=>({next:()=>++ticket,isLatest:id=>id===ticket,signal:()=>undefined}),
  homeScroll:new Map(),rememberHomeScroll:()=>{},playArticleReturn:()=>{},playResultTransition:()=>{},captureResultLayout:()=>[],
  gameApi:{getList:async()=>({data:[]})},
  postApi:{getList:async params=>{
    calls.push({...params})
    const matched=params.game_id?rows.filter(r=>r.game_id===Number(params.game_id)):rows
    const response={data:{total:matched.length,list:matched.slice((params.page-1)*params.pageSize,params.page*params.pageSize)}}
    if(deferredRequest){const hold=deferredRequest;deferredRequest=undefined;return hold(response)}
    return response
  }},
}
vm.createContext(context)
const script=home.split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm,'')
vm.runInContext(ts.transpileModule(script+'\nglobalThis.test={fetchPosts,pageSize,pageCount,page,posts,goPage,handleGameChange,updateLayout,parsePost,results};',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText,context)
const app=context.test
async function settle(){for(let i=0;i<10;i++){await nextTick();await Promise.resolve()}}
async function resize(width){
  context.window.innerWidth=width
  context.document.documentElement.clientWidth=width-(width>=768?17:0)
  app.updateLayout();frames.shift()();await settle()
}
await settle()
assert.equal(app.pageSize.value,15)
assert.equal(app.parsePost({has_video:true}).has_video,true)
assert.equal(app.parsePost({}).has_video,false)
for(const [page,count] of [[1,15],[2,15],[3,6]]){
  await navigate({query:page===1?{}:{page:String(page)}});await settle()
  assert.equal(app.posts.value.length,count);assert.equal(app.pageCount.value,3)
}
const before=navigations.length
app.goPage(4);assert.equal(navigations.length,before)
app.handleGameChange('8');await settle()
assert.equal(route.query.page,undefined);assert.equal(app.posts.value.length,2)
await navigate({query:{page:'99'}});await settle()
assert.equal(route.query.page,'3')

// Keep a currently visible article in its new page and preserve its viewport offset.
await navigate({query:{page:'2'}});await settle()
app.results.value={
  querySelectorAll:()=>[{dataset:{postId:'20'},getBoundingClientRect:()=>({top:-30,bottom:300})}],
  querySelector:()=>({getBoundingClientRect:()=>({top:100})}),
}
await resize(950)
assert.equal(app.pageSize.value,16);assert.equal(app.page.value,2)
assert.ok(app.posts.value.some(post=>post.id===20))
assert.equal(scrolls.at(-1).top,730)
app.results.value=null
for(const [page,count] of [[1,16],[2,16],[3,4]]){
  await navigate({query:{page:String(page)}});await settle()
  assert.equal(app.posts.value.length,count)
}
const requestCount=calls.length
await resize(970)
assert.equal(calls.length,requestCount,'same capacity must not refetch on every pixel')

// A boundary article may move to another page when capacity changes; keep it visible.
await resize(1920)
await navigate({query:{page:'2'}});await settle()
app.results.value={
  querySelectorAll:()=>[{dataset:{postId:'16'},getBoundingClientRect:()=>({top:0,bottom:300})}],
  querySelector:()=>({getBoundingClientRect:()=>({top:100})}),
}
await resize(950)
assert.equal(app.page.value,1)
assert.equal(route.query.page,undefined)
assert.ok(app.posts.value.some(post=>post.id===16))
app.results.value=null

// A slow response for an old capacity must never replace the resized page.
await navigate({query:{}});await settle()
let releaseOld
deferredRequest=response=>new Promise(resolve=>{releaseOld=()=>resolve(response)})
await resize(1920);await resize(1440)
assert.equal(app.pageSize.value,16)
releaseOld();await settle()
assert.equal(app.posts.value.length,16)
await resize(390)
assert.equal(app.pageSize.value,15);assert.equal(app.posts.value.length,15)
for(const stop of watchers)stop()
console.log('PASS 320–3840px row/width fit, measured containers, pagination, filters, stale URLs, reading anchor, request races and no per-pixel refetch')
