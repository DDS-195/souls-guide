/* global console, URL */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8')
const badgeSource=read('../src/components/VideoCoverBadge.vue')
function render(source) {
  const template=source.split('<template>')[1].split('</template>')[0]
  return new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue)
}
const Badge={props:['small'],render:render(badgeSource)}
const RouterLink={props:['to'],setup:(props,{slots})=>()=>Vue.h('a',{href:props.to},slots.default?.())}
const source=read('../src/components/PostCard.vue')
async function cardHtml(hasVideo,{cover='/uploads/images/cover.webp',failed=false}={}) {
  const Card={props:['post','compact','eager','priority','imageSizes','maxImageWidth'],
    components:{VideoCoverBadge:Badge,RouterLink,UserAvatar:{render:()=>Vue.h('span')}},
    setup:()=>({coverFailed:failed,imageVariant:url=>url,imageSrcset:()=>'',fmt:String,route:{fullPath:'/'},coverLoaded:()=>{},captureArticleOrigin:()=>{}}),
    render:render(source)}
  const post={id:2,title:'防御反击攻略',game:'艾尔登法环',category:'新手入门',tags:[],views:0,likes:0,comments:0,time:'2026/10/4',author:'玩家',icon:'🗡️',cover,has_video:hasVideo}
  return renderToString(Vue.createSSRApp({render:()=>Vue.h(Card,{post,compact:true})}))
}
for(const options of [{},{cover:''},{failed:true}]) {
  const html=await cardHtml(true,options)
  assert.equal((html.match(/class="video-cover-badge"/g)||[]).length,1)
  assert.match(html,/role="img" aria-label="包含视频"/)
  assert.match(html,/<a href="\/post\/2"/,'marker does not replace article navigation')
  assert.ok(!html.includes('<video'),'list must not create a video player')
}
for(const flag of [false,undefined]) assert.ok(!(await cardHtml(flag)).includes('video-cover-badge'))
const small=await renderToString(Vue.createSSRApp({render:()=>Vue.h(Badge,{small:true})}))
assert.match(small,/video-cover-badge--small/)
assert.match(badgeSource,/pointer-events: none/,'indicator must not intercept the stretched article link')
assert.match(badgeSource,/position: absolute/,'badge must not change card dimensions')
assert.match(badgeSource,/@media \(max-width: 767px\)/)
for(const page of ['Home','MyLists','Search']) assert.match(read(`../src/views/${page}.vue`),/has_video: p\.has_video === true/)
assert.match(read('../src/views/UserProfile.vue'),/<VideoCoverBadge v-if="p\.has_video" small/)
console.log('PASS video-only cover indicator, empty/failed cover fallback, accessible label, mobile/small variants, unchanged article link and no video preload')
