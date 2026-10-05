<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { adminApi } from '../../api'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import { usePagination } from '../../composables/usePagination'
import { errorMessage } from '../../utils/errors'
import { copyText } from '../../utils/clipboard'
import type { OperationLog, User } from '../../types/api'

const ACTIONS = [
 ['approve_post','通过文章'],['reject_post','驳回文章'],['approve_application','通过申请'],['reject_application','驳回申请'],
 ['resolve_report','处理举报'],['ban_user','封禁用户'],['unban_user','解封用户'],['delete_user','删除用户'],
 ['create_announcement','创建公告'],['update_announcement','更新公告'],['clone_announcement','复制公告草稿'],
 ['publish_announcement','发布公告'],['archive_announcement','归档公告'],['delete_announcement','删除公告'],
 ['send_notification','发送通知'],['create_game','创建游戏'],['update_game','更新游戏'],['delete_game','删除游戏'],['sort_games','排序游戏'],
] as const
const names: Record<string,string> = Object.fromEntries(ACTIONS)
const targets: Record<string,string> = { user:'用户',post:'文章',game:'游戏',announcement:'公告',notification:'通知批次',report:'举报' }
const targetLabel = (r:OperationLog) => (targets[r.target_type || ''] || r.target_type || '未记录对象') + (r.target_id == null ? '' : ' #' + r.target_id)
const time = (v?:string) => v ? new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—'
const day = (n=0) => new Date(Date.now()+8*3600000-n*86400000).toISOString().slice(0,10)
const defaults = () => ({action:'',keyword:'',start:day(6),end:day(),admin_id:'',request_id:'',target_type:'',target_id:''})
const filters = ref(defaults()), applied = ref(defaults())
const advanced = ref(false), range = ref('7'), validation = ref('')
const appliedPreset = ref('7')
const list = ref<OperationLog[]>([]), loading = ref(true), error = ref('')
const {page,total,pageCount,pageSize,go,reset} = usePagination(10)
let sequence=0, actorSequence=0
const storageKey='souls-admin-logs-view-v2'
const appliedRange=computed(() => (applied.value.start || '不限起始')+' 至 '+(applied.value.end || '不限结束'))
function save() { try { sessionStorage.setItem(storageKey,JSON.stringify({filters:applied.value,page:page.value,range:appliedPreset.value})) } catch { /* 缓存不可用不影响查询 */ } }
async function load() {
 const ticket=++sequence
 loading.value=true;error.value=''
 try {
  const query=Object.fromEntries(Object.entries(applied.value).filter(([,v])=>v!==''))
  const r=await adminApi.getLogs({...query,page:page.value,pageSize})
  if(ticket!==sequence)return
  list.value=r.data.list || [];total.value=r.data.total || 0
  if(page.value>pageCount.value){page.value=pageCount.value;return load()}
  save()
 } catch(e){if(ticket===sequence)error.value=errorMessage(e,'日志加载失败，请重试')}
 finally{if(ticket===sequence)loading.value=false}
}
function setRange(){if(range.value!=='custom'){filters.value.start=day(Number(range.value)-1);filters.value.end=day()}}
function applyFilter(){
 validation.value=''
 if(filters.value.start && filters.value.end && filters.value.start>filters.value.end){validation.value='开始日期不能晚于结束日期';return}
 for(const key of ['admin_id','target_id'] as const){
  const v=filters.value[key].trim()
  if(v && (!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)){validation.value='操作者和对象编号必须是正整数';return}
 }
 applied.value=Object.fromEntries(Object.entries(filters.value).map(([k,v])=>[k,v.trim()])) as typeof applied.value
 appliedPreset.value=range.value
 reset();void load()
}
function resetFilter(){filters.value=defaults();range.value='7';actorQuery.value='';actors.value=[];actorError.value='';actorSequence++;actorLoading.value=false;applyFilter()}
function goPage(p:number){if(!loading.value && go(p))void load()}
const actorQuery=ref(''),actorError=ref(''),actorLoading=ref(false),actors=ref<User[]>([])
async function searchActors(){
 const ticket=++actorSequence
 actors.value=[];actorError.value=''
 if(!actorQuery.value.trim()){actorError.value='请输入用户名关键词';return}
 actorLoading.value=true
 try{
  const r=await adminApi.getUsers({keyword:actorQuery.value.trim(),page:1,pageSize:10})
  if(ticket!==actorSequence)return
  actors.value=r.data.list
  actorError.value=r.data.total>10?'仅显示前 10 项，请缩小关键词范围':actors.value.length?'':'未找到用户；历史已删除账号可直接填写 ID'
 }catch(e){if(ticket===actorSequence)actorError.value=errorMessage(e,'查找失败')}
 finally{if(ticket===actorSequence)actorLoading.value=false}
}
const selected=ref<OperationLog|null>(null),panel=ref<HTMLDialogElement|null>(null),copyNotice=ref('')
let oldOverflow='',returnFocus:HTMLElement|null=null
async function openDetail(r:OperationLog){
 returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
 selected.value=r;copyNotice.value=''
 await nextTick()
 oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden'
 panel.value?.showModal()
}
function closeDetail(){panel.value?.close();selected.value=null;document.body.style.overflow=oldOverflow;returnFocus?.focus({preventScroll:true})}
async function copyRequest(value:string){
 try{await copyText(value);copyNotice.value='请求编号已复制'}catch{copyNotice.value='复制失败，请选中编号手动复制'}
}
onMounted(()=>{
 try{
  const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null')
  if(saved?.filters){
   for(const key of Object.keys(filters.value) as (keyof typeof filters.value)[])if(typeof saved.filters[key]==='string')filters.value[key]=saved.filters[key]
   range.value=['1','7','30'].includes(saved.range) && filters.value.start===day(Number(saved.range)-1) && filters.value.end===day() ? saved.range : 'custom'
   appliedPreset.value=range.value;applied.value={...filters.value}
   if(Number.isSafeInteger(saved.page)&&saved.page>0)page.value=saved.page
   advanced.value=!!(filters.value.admin_id||filters.value.request_id||filters.value.target_id||filters.value.target_type)
  }
 }catch{/* 非法缓存使用默认筛选 */}
 void load()
})
onBeforeUnmount(()=>{sequence++;actorSequence++;if(selected.value){panel.value?.close();document.body.style.overflow=oldOverflow}})
</script>

<template>
 <main class="logs-page">
  <header class="page-head"><div><h2>操作日志</h2><p>仅记录成功的管理操作 · 北京时间</p></div><button :disabled="loading" @click="load">刷新</button></header>
  <form class="filters" @submit.prevent="applyFilter">
   <div class="basic-grid">
    <label>时间范围<select v-model="range" @change="setRange"><option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="custom">自定义</option></select></label>
    <label>操作类型<select v-model="filters.action"><option value="">全部操作</option><option v-for="[value,label] in ACTIONS" :key="value" :value="value">{{label}}</option></select></label>
    <label class="keyword">描述关键词<input v-model="filters.keyword" maxlength="200" placeholder="搜索操作摘要或原因" /></label>
   </div>
   <div v-if="range==='custom'" class="dates"><label>开始日期<input v-model="filters.start" type="date" /></label><label>结束日期<input v-model="filters.end" type="date" /></label></div>
   <div v-if="advanced" id="log-more-filters" class="more-grid">
    <div class="actor-search"><label>查找操作者<input v-model="actorQuery" maxlength="100" placeholder="输入用户名关键词" @keydown.enter.prevent="searchActors" /></label><button type="button" :disabled="actorLoading" @click="searchActors">{{actorLoading?'查找中':'查找用户'}}</button>
     <label v-if="actors.length" class="actor-options">选择账号<select v-model="filters.admin_id"><option value="">请选择</option><option v-for="u in actors" :key="u.id" :value="String(u.id)">{{u.username}} · #{{u.id}}</option></select></label>
     <small v-if="actorError" role="status">{{actorError}}</small>
    </div>
    <label>操作者 ID<input v-model="filters.admin_id" inputmode="numeric" placeholder="选择用户自动填入，也可直接输入" /></label>
    <label>对象类型<select v-model="filters.target_type"><option value="">全部对象</option><option v-for="(label,value) in targets" :key="value" :value="value">{{label}}</option></select></label>
    <label>对象 ID<input v-model="filters.target_id" inputmode="numeric" placeholder="精确编号" /></label>
    <label class="request-filter">请求编号<input v-model="filters.request_id" maxlength="128" placeholder="粘贴请求编号精确定位" /></label>
   </div>
   <div class="filter-actions"><button type="button" class="text-button" :aria-expanded="advanced" aria-controls="log-more-filters" @click="advanced=!advanced">{{advanced?'收起筛选 −':'更多筛选 +'}}</button><div><button type="button" @click="resetFilter">重置</button><button class="primary" type="submit" :disabled="loading">查询</button></div></div>
   <p v-if="validation" class="validation" role="alert">{{validation}}</p>
  </form>
  <div class="result-head"><span>{{appliedRange}}</span><span v-if="!loading&&!error">共 {{total}} 条</span><span v-else-if="loading" role="status">正在查询…</span></div>
  <AppEmpty v-if="loading||error||!list.length" :loading="loading" :error="error" empty-text="此范围内没有匹配记录，可调整时间或筛选条件" icon="📜" @retry="load" />
  <template v-else>
   <div class="table-wrap"><table><caption class="sr-only">操作日志查询结果</caption><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>摘要</th><th><span class="sr-only">详情</span></th></tr></thead><tbody>
    <tr v-for="r in list" :key="r.id"><td class="time-cell">{{time(r.created_at)}}</td><td><span class="clamp">{{r.admin_username||'未记录'}}</span></td><td>{{names[r.action]||r.action}}</td><td>{{targetLabel(r)}}</td><td><span class="clamp">{{r.detail||'—'}}</span></td><td><button class="text-button" :aria-label="'查看日志 #'+r.id+' 详情'" @click="openDetail(r)">详情</button></td></tr>
   </tbody></table></div>
   <div class="mobile-list"><article v-for="r in list" :key="r.id"><div class="record-top"><strong>{{names[r.action]||r.action}}</strong><button class="text-button" :aria-label="'查看日志 #'+r.id+' 详情'" @click="openDetail(r)">详情</button></div><p class="clamp">{{r.detail||'—'}}</p><div class="record-meta"><span>{{r.admin_username}} · {{targetLabel(r)}}</span><time>{{time(r.created_at)}}</time></div></article></div>
   <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
  </template>
  <Teleport to="body"><dialog ref="panel" class="log-panel" aria-labelledby="log-detail-title" @cancel.prevent="closeDetail" @click="(e)=>{if(e.target===panel)closeDetail()}">
   <div v-if="selected" class="panel-body"><header class="panel-head"><div><h2 id="log-detail-title">操作详情</h2><small>日志 #{{selected.id}} · 北京时间</small></div><button class="panel-close" autofocus aria-label="关闭详情" @click="closeDetail">×</button></header>
    <section>
      <h3>{{names[selected.action]||selected.action}}</h3>
      <p class="full-summary">{{selected.detail||'未记录摘要'}}</p>
      <dl>
        <dt>操作时间</dt><dd>{{time(selected.created_at)}}</dd>
        <dt>操作者</dt><dd>{{selected.admin_username}} · #{{selected.admin_id}}</dd>
        <dt>操作对象</dt><dd>{{targetLabel(selected)}}</dd>
        <dt>请求编号</dt><dd>{{selected.request_id||'旧记录未保存'}} <button v-if="selected.request_id" class="text-button" @click="copyRequest(selected.request_id)">复制</button></dd>
        <dt>来源 IP</dt><dd>{{selected.ip||'未记录'}}</dd>
        <dt>接口</dt><dd>{{selected.method}} {{selected.path}}</dd>
        <dt>HTTP 状态</dt><dd>{{selected.status}}</dd>
        <dt>业务事件</dt><dd>{{selected.event_key||'未记录'}}</dd>
        <template v-if="selected.metadata"><dt>元数据</dt><dd><pre class="inline-metadata">{{JSON.stringify(selected.metadata,null,2)}}</pre></dd></template>
      </dl>
      <p v-if="copyNotice" role="status" class="copy-notice">{{copyNotice}}</p>
    </section>
   </div>
  </dialog></Teleport>
 </main>
</template>

<style scoped>
.logs-page{max-width:1080px;margin:0 auto;padding:24px 20px 40px;color:var(--text-primary)}
.page-head,.filter-actions,.result-head,.record-top,.panel-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
h2{margin:0;font-size:1.3rem;color:var(--amber)}.page-head p{font-size:.8rem;color:var(--text-muted);margin:8px 0 0}.page-head{margin-bottom:24px}
button,input,select{font:inherit;font-size:.82rem;color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;background:var(--bg-card);min-height:36px;box-sizing:border-box}
button{padding:6px 14px;cursor:pointer;white-space:nowrap}button:hover:not(:disabled){border-color:var(--amber)}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
.filters{padding:18px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px}.basic-grid{display:grid;grid-template-columns:160px 180px minmax(0,1fr);gap:16px}
label{display:flex;flex-direction:column;gap:8px;font-size:.78rem;color:var(--text-secondary);min-width:0}input,select{width:100%;min-width:0;padding:7px 10px;background:var(--bg-primary,var(--bg-card))}
.dates{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:440px;margin-top:16px}.more-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-subtle)}.actor-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.actor-options,.actor-search small{grid-column:1/-1}.request-filter{grid-column:1/-1}.filter-actions{margin-top:18px}.filter-actions>div{display:flex;gap:10px}.text-button{border:0;background:transparent;color:var(--amber);padding:4px 6px}.primary{background:var(--amber);color:var(--on-amber);border-color:var(--amber)}.validation{color:var(--red,#c65c5c);font-size:.82rem;margin:12px 0 0}
.result-head{font-size:.78rem;color:var(--text-muted);margin:20px 0 12px;flex-wrap:wrap}.table-wrap{border:1px solid var(--border-subtle);border-radius:10px;overflow:hidden}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:.8rem;text-align:left;background:var(--bg-card)}th{color:var(--text-muted);font-weight:500;background:var(--bg-hover)}th,td{padding:13px 12px;border-bottom:1px solid var(--border-subtle);overflow-wrap:anywhere}th:nth-child(1){width:145px}th:nth-child(2){width:100px}th:nth-child(3){width:105px}th:nth-child(4){width:110px}th:last-child{width:60px}tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--bg-hover)}.time-cell{font-variant-numeric:tabular-nums;color:var(--text-secondary);font-size:.75rem}.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.65}.mobile-list{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.log-panel{position:fixed;inset:0 0 0 auto;margin:0;width:min(520px,100%);max-width:100%;height:100dvh;max-height:100dvh;padding:0;border:0;border-left:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);box-sizing:border-box;overflow-y:auto}.log-panel::backdrop{background:rgba(0,0,0,.45)}.panel-body{padding:24px}.panel-head{padding-bottom:20px;border-bottom:1px solid var(--border-subtle)}.panel-head small{display:block;margin-top:8px;color:var(--text-muted)}section{padding:20px 0;border-bottom:1px solid var(--border-subtle)}h3{font-size:.95rem;margin:0 0 14px}.full-summary{font-size:.9rem;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:85px minmax(0,1fr);gap:14px;font-size:.82rem;line-height:1.7;margin:0}dt{color:var(--text-muted)}dd{margin:0;overflow-wrap:anywhere}.copy-notice{font-size:.8rem;color:var(--amber);margin:10px 0 0}.log-panel details{margin-top:20px;font-size:.8rem}.log-panel summary{cursor:pointer;color:var(--text-secondary)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.75rem;line-height:1.7;background:var(--bg-hover);padding:12px;border-radius:6px}
@media(max-width:850px){.table-wrap{display:none}.mobile-list{display:block;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-card)}article{padding:14px 16px;border-bottom:1px solid var(--border-subtle)}article:last-child{border-bottom:0}.record-top strong{font-size:.85rem}.mobile-list p{font-size:.83rem;margin:6px 0 10px}.record-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:.73rem;color:var(--text-muted);overflow-wrap:anywhere}.basic-grid{grid-template-columns:1fr 1fr}.keyword{grid-column:1/-1}}
@media(max-width:520px){.logs-page{padding:20px 12px 32px}.filters{padding:14px}.more-grid{grid-template-columns:1fr}.basic-grid,.dates{gap:12px}.page-head{margin-bottom:20px}.panel-body{padding:20px 16px}.log-panel{width:100%;border:0}.result-head{gap:6px;font-size:.73rem}}
/* 详情以轻量居中浮层呈现，不再用通高侧栏割裂列表。 */
.log-panel {
  inset: 0;
  margin: auto;
  width: min(560px, calc(100% - 40px));
  height: fit-content;
  max-height: calc(100dvh - 64px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: 0 20px 70px rgba(0, 0, 0, .25);
  overscroll-behavior: contain;
}
.log-panel[open] { animation: detail-enter 180ms ease-out; }
.log-panel::backdrop { background: rgba(0, 0, 0, .32); }
.log-panel[open]::backdrop { animation: detail-shade 180ms ease-out; }
.panel-body { padding: 24px; }
.panel-head { padding-bottom: 20px; border: 0; align-items: flex-start; }
.panel-head h2 { color: var(--text-primary); font-size: 1rem; font-weight: 600; }
.panel-head small { font-size: .73rem; margin-top: 6px; }
.panel-close { width: 34px; min-height: 34px; padding: 0; border: 0; background: var(--bg-hover); color: var(--text-muted); font-size: 1.3rem; border-radius: 50%; }
.panel-close:hover { color: var(--text-primary); }
.log-panel section { padding: 18px; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-hover); }
.log-panel h3 { color: var(--amber); font-size: .92rem; margin-bottom: 8px; }
.full-summary { margin: 0 0 20px; font-size: .85rem; line-height: 1.7; }
.log-panel dl { gap: 10px 16px; font-size: .8rem; }
.log-panel details { border-top: 1px solid var(--border-subtle); margin-top: 18px; padding-top: 16px; }
.log-panel summary { min-height: 28px; line-height: 28px; }
.inline-metadata { margin: 0; padding: 0; }
@keyframes detail-enter { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes detail-shade { from { background: transparent; } to { background: rgba(0,0,0,.32); } }
@media (max-width: 520px) {
  .log-panel { width: calc(100% - 24px); max-height: calc(100dvh - 40px); border-radius: 14px; }
  .panel-body { padding: 18px; }
  .log-panel section { padding: 14px; }
  .log-panel dl { grid-template-columns: 68px minmax(0,1fr); gap: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .log-panel[open], .log-panel[open]::backdrop { animation: none; }
}
</style>
