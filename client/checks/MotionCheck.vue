<script setup lang="ts">
import { ref, nextTick } from 'vue'
import AppModal from '../src/components/AppModal.vue'
import PostCard from '../src/components/PostCard.vue'
import {playFeedback} from '../src/utils/motion'
import {useTheme} from '../src/utils/theme'
const show=ref(false),result=ref('尚未关闭'),icon=ref<HTMLElement|null>(null)
const theme=useTheme()
const post={id:1,title:'动效验收：短标题与缺图仍保持卡片尺寸',game:'艾尔登法环',category:'新手入门',tags:['近战'],views:0,likes:0,comments:0,time:'今天',author:'验收',cover:'/missing-motion-check.webp'}
async function close(){show.value=false;await nextTick();result.value=document.querySelector('.am-leave-active')?'退出过渡已触发':'退出过渡未触发'}
</script>
<template><main style="padding:32px;max-width:760px;margin:auto">
<h1>动效本地验收</h1><button class="btn-main" @click="show=true">打开弹窗</button>
<button class="btn-sub" @click="theme.toggle">切换主题</button>
<button class="action-item" @click="playFeedback(icon,'confirm')"><span ref="icon" style="display:inline-block">⭐</span> 成功反馈</button>
<p>{{result}}</p><div style="max-width:320px"><PostCard :post="post" compact eager /></div>
<AppModal :open="Boolean(show)" title="键盘与退出动效检查" @close="close"><template v-if="show"><input aria-label="测试输入"><button class="btn-sub" @click="close">关闭弹窗</button></template></AppModal>
</main></template>
