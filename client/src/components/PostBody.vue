<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import DOMPurify from 'dompurify'

/**
 * 文章正文渲染组件（纯展示，D22：content 为富文本 HTML）
 * 渲染规则：media 中第一个 video 渲染在标题之后；正文为 DOMPurify 消毒后的 HTML
 * （唯一展示入口，必须消毒）；图片加载失败 → 占位，不破坏排版。
 * 数据契约见设计文档 4.1（media 数组 + content HTML）。
 */
const props = defineProps<{ post: any }>()

const bodyRef = ref<HTMLElement | null>(null)

// 视频：media 中第一个 type=video（后端按 sort_order 排序返回）
const video = computed(() => props.post?.media?.find((m: any) => m.type === 'video'))

// 正文：DOMPurify 消毒（默认配置：剥离 script 等危险标签，允许相对 /uploads 图片）
const html = computed(() => DOMPurify.sanitize(props.post?.content || ''))

// 图片加载失败 → 占位（v-html 内无法写 @error，需挂载后逐个绑定）
watch(
  html,
  () => {
    nextTick(() => {
      bodyRef.value?.querySelectorAll('img').forEach((img) => {
        img.addEventListener(
          'error',
          () => {
            const fb = document.createElement('div')
            fb.className = 'img-fallback'
            fb.textContent = '图片加载失败'
            img.replaceWith(fb)
          },
          { once: true },
        )
      })
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="post-body">
    <!-- 视频：标题之后第一个 -->
    <div v-if="video" class="media-block">
      <video class="media-video" :poster="post.cover || undefined" controls preload="metadata" playsinline>
        <source :src="video.url" type="video/mp4" />
      </video>
    </div>

    <!-- 正文：消毒后 HTML -->
    <div ref="bodyRef" class="body-html" v-html="html"></div>
  </div>
</template>

<style scoped>
.post-body {
  min-width: 0;
}
.media-block {
  margin-bottom: 20px;
}
.media-video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: var(--bg-card);
  border-radius: var(--radius-md);
}
/* v-html 注入的节点不受 scoped 属性约束，用 :deep 排版（风格对齐原 body-text） */
.body-html {
  line-height: 1.9;
  font-size: 0.92rem;
  word-break: break-word;
}
.body-html :deep(p) {
  margin: 0 0 1em;
  white-space: pre-wrap;
}
.body-html :deep(h1),
.body-html :deep(h2),
.body-html :deep(h3),
.body-html :deep(h4) {
  font-family: var(--font-display);
  color: var(--text-primary);
  margin: 1.2em 0 0.6em;
  line-height: 1.4;
}
.body-html :deep(h1) {
  font-size: 1.5rem;
}
.body-html :deep(h2) {
  font-size: 1.3rem;
}
.body-html :deep(h3) {
  font-size: 1.15rem;
}
.body-html :deep(h4) {
  font-size: 1rem;
}
.body-html :deep(ul),
.body-html :deep(ol) {
  margin: 0 0 1em;
  padding-left: 1.5em;
}
.body-html :deep(li) {
  margin: 0.2em 0;
}
.body-html :deep(a) {
  color: var(--cyan);
}
.body-html :deep(blockquote) {
  margin: 0 0 1em;
  padding: 0.5em 1em;
  border-left: 3px solid var(--amber);
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.body-html :deep(code) {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.85em;
}
.body-html :deep(pre) {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 0 0 1em;
}
.body-html :deep(pre code) {
  border: none;
  padding: 0;
  background: transparent;
}
.body-html :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  margin: 16px 0;
}
.body-html :deep(table) {
  border-collapse: collapse;
  margin: 0 0 1em;
}
.body-html :deep(th),
.body-html :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 6px 10px;
}
.body-html :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.2em 0;
}
.img-fallback {
  display: block;
  margin: 16px 0;
  padding: 40px 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  background: var(--bg-card);
  border-radius: var(--radius-md);
}
</style>
