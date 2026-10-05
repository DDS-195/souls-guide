<script setup lang="ts">
import { ref, computed, watch, nextTick, useId, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { imageVariant } from '../utils/responsiveImage'
import type { Post } from '../types/api'
import { formatTime } from '../utils/guide'
import ExpandPanel from './ExpandPanel.vue'
import { useSelectionIndicator } from '../composables/useSelectionIndicator'

/**
 * 文章正文渲染组件（纯展示，D22：content 为富文本 HTML）
 * 渲染规则：media 中第一个 video 渲染在标题之后；正文为 DOMPurify 消毒后的 HTML
 * （唯一展示入口，必须消毒）；图片加载失败 → 占位，不破坏排版。
 * 数据契约见设计文档 4.1（media 数组 + content HTML）。
 */
const props = defineProps<{ post: Pick<Post, 'cover' | 'content' | 'media' | 'guide_info'>; readingTools?: boolean }>()

const bodyRef = ref<HTMLElement | null>(null)
const sectionPrefix = `sg-section-${useId().replace(/[^a-zA-Z0-9-]/g,'')}`
const tocOpen = ref(false)
const tocNav = ref<HTMLElement | null>(null)
const activeSection = ref('')
const readingProgress = ref(0)
const tocIndicator = useSelectionIndicator(tocNav, [activeSection, tocOpen], '[aria-current="location"]')
let readingFrame = 0
let bodyObserver: ResizeObserver | null = null
let headingPositions: { id: string; top: number }[] = []
let bodyTop = 0
let bodyBottom = 0
let readingDisposed = false
function updateReading() {
  const available = bodyBottom - bodyTop - window.innerHeight + 100
  readingProgress.value = available > 0 ? Math.max(0, Math.min(1, (window.scrollY + 90 - bodyTop) / available)) : window.scrollY + window.innerHeight >= bodyBottom ? 1 : 0
  let current = headingPositions[0]?.id || ''
  for (const section of headingPositions) { if (section.top > window.scrollY + 120) break; current = section.id }
  activeSection.value = current
}
function measureReading() {
  if (!props.readingTools || !bodyRef.value || readingDisposed) return
  const rect = bodyRef.value.getBoundingClientRect()
  bodyTop = rect.top + window.scrollY
  bodyBottom = rect.bottom + window.scrollY
  headingPositions = Array.from(bodyRef.value.querySelectorAll<HTMLElement>('h1,h2,h3,h4')).map(el => ({ id: el.id, top: el.getBoundingClientRect().top + window.scrollY }))
  updateReading()
}
function onReadingScroll() {
  if (readingFrame) return
  readingFrame = requestAnimationFrame(() => { readingFrame = 0; updateReading() })
}
onMounted(() => {
  if (!props.readingTools) return
  measureReading()
  window.addEventListener('scroll', onReadingScroll, { passive: true })
  window.addEventListener('resize', measureReading, { passive: true })
  if (bodyRef.value && typeof ResizeObserver !== 'undefined') {
    bodyObserver = new ResizeObserver(measureReading)
    bodyObserver.observe(bodyRef.value)
    if (bodyRef.value.parentElement) bodyObserver.observe(bodyRef.value.parentElement)
  }
})
onUnmounted(() => {
  readingDisposed = true
  cancelAnimationFrame(readingFrame)
  bodyObserver?.disconnect()
  window.removeEventListener('scroll', onReadingScroll)
  window.removeEventListener('resize', measureReading)
})
const videoRef = ref<HTMLVideoElement | null>(null)
const videoDuration = ref(0)
const pendingSeek = ref<number | null>(null)
const seekMessage = ref('')
const chapters = computed(() => props.post.guide_info?.video_chapters || [])
const guide = computed(() => props.post.guide_info)
const hasOverview = computed(() => !!guide.value && (!!guide.value.summary || !!guide.value.game_version || !!guide.value.prerequisites || guide.value.spoiler !== 'none'))
function seek(seconds: number) {
  const el = videoRef.value
  if (!el || videoFailed.value) return
  el.scrollIntoView({ block:'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  if (!el.readyState) { pendingSeek.value = seconds; el.load(); seekMessage.value = '正在加载视频信息…'; return }
  if (!Number.isFinite(el.duration) || seconds >= el.duration) { seekMessage.value = '该时间点超出视频时长，请查看其他时间点'; pendingSeek.value = null; return }
  el.currentTime = seconds
  pendingSeek.value = null
  el.focus({ preventScroll: true })
  seekMessage.value = `已跳转至 ${formatTime(seconds)}，点击播放即可观看`
}
function videoReady() {
  videoDuration.value = videoRef.value?.duration || 0
  if (pendingSeek.value !== null) seek(pendingSeek.value)
}
function jumpSection(id: string) {
  const el = bodyRef.value?.querySelector<HTMLElement>(`#${id}`)
  el?.scrollIntoView({ block:'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  el?.focus({ preventScroll: true })
}

// 视频：media 中第一个 type=video（后端按 sort_order 排序返回）
const video = computed(() => props.post.media?.find((media) => media.type === 'video'))
const videoFailed = ref(false)
watch(() => video.value?.url, () => { videoFailed.value = false; videoDuration.value = 0; pendingSeek.value = null; seekMessage.value = '' })

// 正文：DOMPurify 消毒（默认配置：剥离 script 等危险标签，允许相对 /uploads 图片）
const parsedBody = computed(() => {
  const fragment = DOMPurify.sanitize(props.post.content || '', { RETURN_DOM_FRAGMENT: true })
  fragment.querySelectorAll('img').forEach((img) => {
    img.loading = 'lazy'
    img.decoding = 'async'
  })
  const container = document.createElement('div')
  container.append(fragment)
  const anchorMap = new Map<string, string>()
  const sections = Array.from(container.querySelectorAll('h1,h2,h3,h4')).map((el, index) => {
    const id = `${sectionPrefix}-${index}`
    if (el.id && !anchorMap.has(el.id)) anchorMap.set(el.id, id)
    el.id = id
    el.setAttribute('tabindex','-1')
    return { id, title: el.textContent?.trim() || '', level: Number(el.tagName.slice(1)) }
  }).filter(section => section.title)
  // Preserve author-written in-page links when generated section IDs replace heading IDs.
  container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
    let old = link.getAttribute('href')!.slice(1)
    try { old = decodeURIComponent(old) } catch { /* Keep malformed fragments as authored. */ }
    const next = anchorMap.get(old)
    if (next) link.setAttribute('href', '#' + next)
  })
  return { html:container.innerHTML, sections }
})
const html = computed(() => parsedBody.value.html)

// 图片加载失败 → 占位（v-html 内无法写 @error，需挂载后逐个绑定）
watch(
  html,
  () => {
    nextTick(() => {
      if (readingDisposed) return
      measureReading()
      bodyRef.value?.querySelectorAll('img').forEach((img) => {
        img.loading = 'lazy'
        img.decoding = 'async'
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
    <div v-if="readingTools" class="reading-progress" role="progressbar" aria-label="文章阅读进度" :aria-valuenow="Math.round(readingProgress * 100)" aria-valuemin="0" aria-valuemax="100"><span :style="{ transform: `scaleX(${readingProgress})` }" /></div>
    <section v-if="hasOverview" class="guide-overview" aria-label="攻略概况">
      <span class="overview-label">攻略概况</span>
      <p v-if="guide?.summary" class="guide-summary">{{ guide.summary }}</p>
      <dl><template v-if="guide?.game_version"><dt>适用版本</dt><dd>{{ guide.game_version }}</dd></template><template v-if="guide?.prerequisites"><dt>前置条件</dt><dd>{{ guide.prerequisites }}</dd></template></dl>
      <p v-if="guide?.spoiler !== 'none'" class="spoiler-note">{{ guide?.spoiler === 'major' ? '包含重要剧情剧透，请酌情阅读' : '包含轻微剧透，请酌情阅读' }}</p>
    </section>
    <section v-if="parsedBody.sections.length > 1" class="article-toc">
      <button type="button" class="toc-heading" :aria-expanded="tocOpen" :aria-controls="`${sectionPrefix}-toc`" @click="tocOpen = !tocOpen"><span>文章目录 <small>{{ parsedBody.sections.length }} 节</small></span><svg class="toc-arrow" :class="{ open: tocOpen }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
      <ExpandPanel :open="tocOpen">
        <nav :id="`${sectionPrefix}-toc`" ref="tocNav" aria-label="文章目录">
          <span v-if="readingTools && tocIndicator.ready.value" class="selection-indicator toc-indicator" :class="{ 'is-moving': tocIndicator.moving.value }" :style="tocIndicator.style.value" aria-hidden="true" />
          <button v-for="section in parsedBody.sections" :key="section.id" type="button" :class="{ nested: section.level > 2 }" :aria-current="readingTools && activeSection === section.id ? 'location' : undefined" @click="jumpSection(section.id)">{{ section.title }}</button>
        </nav>
      </ExpandPanel>
    </section>
    <!-- 视频：标题之后第一个 -->
    <div v-if="video" class="media-block">
      <p v-if="videoFailed" role="status">视频加载失败，请检查网络后重试。<button @click="videoFailed = false">重试</button></p>
      <video v-else :key="video.url" ref="videoRef" class="media-video" :poster="imageVariant(post.cover, 800)" controls preload="metadata" playsinline @loadedmetadata="videoReady" @error="videoFailed = true">
        <source :src="video.url" type="video/mp4" @error="videoFailed = true" />
      </video>
      <nav v-if="chapters.length" class="video-chapters" aria-label="视频时间点"><button v-for="chapter in chapters" :key="chapter.seconds" type="button" :disabled="videoFailed || (videoDuration > 0 && chapter.seconds >= videoDuration)" @click="seek(chapter.seconds)"><time>{{ formatTime(chapter.seconds) }}</time>{{ chapter.title }}<span v-if="videoDuration > 0 && chapter.seconds >= videoDuration">（超出时长）</span></button></nav>
      <p v-if="seekMessage" class="seek-status" role="status">{{ seekMessage }}</p>
    </div>

    <!-- 正文：消毒后 HTML -->
    <div ref="bodyRef" class="body-html" v-html="html"></div>
  </div>
</template>

<style scoped>
.guide-overview, .article-toc { border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; margin-bottom:20px; background:var(--bg-card); }
.overview-label { font-size:.75rem; font-weight:600; color:var(--amber); }
.guide-summary { font-size:.92rem; line-height:1.8; white-space:pre-wrap; margin:8px 0; }
.guide-overview dl { margin:10px 0 0; display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px 16px; font-size:.8rem; line-height:1.7; }
.guide-overview dt { color:var(--text-muted); }
.guide-overview dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.spoiler-note { color:var(--amber); font-size:.8rem; margin:12px 0 0; }
.article-toc nav { position:relative; display:flex; flex-direction:column; align-items:stretch; margin-top:10px; }
.article-toc button { position:relative; z-index:1; color:var(--text-secondary); background:none; border:0; text-align:left; padding:8px; font:inherit; font-size:.82rem; cursor:pointer; }
.article-toc button.nested { padding-left:22px; }
.article-toc .toc-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:0; font-size:.86rem; }
.toc-heading small { color:var(--text-muted); font-size:.75rem; margin-left:8px; }
.toc-arrow { flex-shrink:0; transition:transform 220ms var(--motion-ease); }
.toc-arrow.open { transform:rotate(180deg); }
.toc-indicator { background:var(--amber-glow); border-radius:6px; border-left:2px solid var(--amber); }
.article-toc button[aria-current="location"] { color:var(--amber); }
.reading-progress { position:fixed; left:0; right:0; top:44px; height:2px; z-index:101; pointer-events:none; }
.reading-progress span { display:block; height:100%; background:var(--amber); transform-origin:left; }
@media (prefers-reduced-motion: reduce) { .toc-arrow { transition:none; } }
.article-toc button:hover { color:var(--amber); }
.body-html :deep(h1), .body-html :deep(h2), .body-html :deep(h3), .body-html :deep(h4) { scroll-margin-top:90px; }
.video-chapters { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.video-chapters button { padding:7px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); color:var(--text-secondary); background:var(--bg-card); font:inherit; font-size:.78rem; cursor:pointer; }
.video-chapters time { color:var(--amber); margin-right:8px; font-variant-numeric:tabular-nums; }
.video-chapters button:disabled { opacity:.5; cursor:not-allowed; }
.seek-status { font-size:.8rem; color:var(--text-muted); }
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
