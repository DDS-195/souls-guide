<script setup lang="ts">
import { ref, watch } from 'vue'
import UserAvatar from './UserAvatar.vue'
import VideoCoverBadge from './VideoCoverBadge.vue'
import { imageVariant, imageSrcset } from '../utils/responsiveImage'
import { playFeedback } from '../utils/motion'
import { useRoute } from 'vue-router'
import { captureArticleOrigin } from '../utils/articleMotion'

const route = useRoute()

const props = defineProps<{
  compact?: boolean
  eager?: boolean
  priority?: boolean
  imageSizes?: string
  maxImageWidth?: number
  post: {
    id?: number
    title: string
    game: string
    category: string
    tags: string[]
    views: number
    likes: number
    comments: number
    time: string
    author: string
    user_id?: number
    icon?: string
    cover?: string
    avatar?: string
    has_video?: boolean
  }
}>()
const coverFailed = ref(false)
function coverLoaded(event: Event) {
  if (!props.eager && !props.priority) playFeedback(event.target as HTMLImageElement, 'image')
}
watch(() => props.post.cover, () => { coverFailed.value = false })
function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>

<template>
  <article class="card" :data-post-id="post.id" :class="{ 'card--compact': compact }">
    <div class="card-cover" :class="{ 'card-cover--empty': !post.cover || coverFailed }">
      <img v-if="post.cover && !coverFailed" class="card-cover-img" :src="imageVariant(post.cover, 800)" :srcset="imageSrcset(post.cover, maxImageWidth)" :sizes="imageSizes || '(max-width: 767px) calc(100vw - 30px), (max-width: 1100px) 45vw, 360px'" width="1280" height="720" alt="" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="priority ? 'high' : 'auto'" decoding="async" @load="coverLoaded" @error="coverFailed = true" />
      <span v-else class="cover-placeholder">{{ post.icon }}</span>
      <VideoCoverBadge v-if="post.has_video" />
      <div class="card-badges">
        <span v-if="post.game" class="badge badge-game">{{ post.game }}</span>
        <span v-if="post.category" class="badge badge-category">{{ post.category }}</span>
      </div>
    </div>
    <div class="card-body">
      <h3 class="card-title"><router-link :to="`/post/${post.id}`" @click="captureArticleOrigin($event, post.id, route.fullPath)">{{ post.title }}</router-link></h3>
      <div class="card-tags">
        <span v-for="t in post.tags" :key="t" class="tag">#{{ t }}</span>
      </div>
      <div class="card-meta">
        <span class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {{ fmt(post.views) }}
        </span>
        <span class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            />
          </svg>
          {{ fmt(post.likes) }}
        </span>
        <span class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {{ post.comments }}
        </span>
        <span class="meta-time">{{ post.time }}</span>
      </div>
      <div class="card-bottom">
        <router-link v-if="post.user_id" :to="`/user/${post.user_id}`" class="card-author" @click.stop>
          <UserAvatar :src="post.avatar" :name="post.author" :size="22" />
          <span class="author-name" :title="post.author">{{ post.author }}</span>
        </router-link>
        <div v-else class="card-author">
          <UserAvatar :src="post.avatar" :name="post.author" :size="22" />
          <span class="author-name" :title="post.author">{{ post.author }}</span>
        </div>
        <span class="card-time">{{ post.time }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  background: var(--bg-card, #1a1f26);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 200ms var(--motion-ease), border-color 180ms, box-shadow 200ms;
  display: flex;
  flex-direction: column;
}
.card:focus-within {
  border-color: var(--border-hover);
  box-shadow: 0 4px 20px var(--amber-glow);
}
.card-cover {
  position: relative;
  aspect-ratio: 16/9;
  background: linear-gradient(135deg, var(--bg-hover), var(--bg-card));
  overflow: hidden;
}
.card-cover::after {
  content: '';
  position: absolute;
  z-index: 1;
  inset: 0;
  background: linear-gradient(112deg, transparent 34%, rgba(255, 225, 166, .11) 49%, transparent 64%);
  pointer-events: none;
  transform: translateX(-115%);
}
.cover-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  opacity: 0.3;
}
.card-cover-img {
  transition: transform 260ms var(--motion-ease);
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-badges {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  display: flex;
  gap: 5px;
}
.badge {
  padding: 3px 9px;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--bg-deep);
}
.badge-game {
  color: var(--amber);
}
.badge-category {
  color: var(--text-secondary, #94a3b8);
}
.card-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.card-title {
  font-family: 'Cinzel', 'Times New Roman', serif;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary, #e2e8f0);
  line-height: 1.4;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.tag {
  font-size: 0.68rem;
  color: var(--cyan);
  background: rgba(59, 157, 181, 0.08);
  padding: 2px 8px;
  border-radius: 3px;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 0.72rem;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.meta-item svg {
  width: 14px;
  height: 14px;
}
.card-bottom {
  display: flex;
  align-items: center;
  margin-top: auto;
  padding-top: 8px;
}
.card-author {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary, #94a3b8);
  text-decoration: none;
}
.card-author:hover {
  color: var(--amber);
}
.author-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.author-avatar--fallback {
  background: linear-gradient(135deg, var(--amber-dim), var(--bg-hover));
}
.card { position: relative; min-width: 0; }
.card-title a { color: inherit; text-decoration: none; }
.card-title a::after { content: ''; position: absolute; inset: 0; z-index: 1; }
.card-title a:focus-visible::after { outline: 2px solid var(--amber); outline-offset: -3px; border-radius: 10px; }
.card-author { position: relative; z-index: 2; overflow-wrap: anywhere; min-width: 0; }
.card-badges { right: 8px; }
.badge { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-body { min-width: 0; }
.card-title, .tag { overflow-wrap: anywhere; }
/* 首页统一分区：缺图、短标题和无标签都不改变卡片尺寸。 */
.card--compact .card-cover { aspect-ratio: 2; flex-shrink: 0; }
.card--compact .card-title { height: 2.8em; flex-shrink: 0; }
.card--compact .card-tags { height: 22px; flex-shrink: 0; flex-wrap: nowrap; overflow: hidden; }
.card--compact .tag { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card--compact .card-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 8px; }
.card--compact .card-meta > :last-child { grid-column: 1 / -1; }
.card--compact .meta-item { min-width: 0; overflow: hidden; white-space: nowrap; }
.card--compact .card-bottom { height: 30px; flex-shrink: 0; }
.card--compact .card-author { max-width: 100%; }
.author-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-time { display:none; }
@media (max-width: 767px) {
  .card--compact .card-cover { aspect-ratio:2.5; }
  .card--compact .card-body { padding:10px 12px; }
  .card--compact .card-title { height:auto; margin-bottom:6px; }
  .card--compact .card-tags { height:20px; margin-bottom:6px; }
  .card--compact .card-tags:empty { display:none; }
  .card--compact .card-meta { gap:4px 8px; }
  .card--compact .meta-time { display:none; }
  .card--compact .card-bottom { height:28px; padding-top:6px; gap:10px; justify-content:space-between; }
  .card--compact .card-author { flex:1; }
  .card--compact .card-time { display:block; flex-shrink:0; font-size:.68rem; color:var(--text-muted); white-space:nowrap; }
}
@media (min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .card:hover { transform: translateY(-3px); border-color: var(--border-hover); box-shadow: 0 7px 22px var(--amber-glow); }
  .card:hover .card-cover-img { transform: scale(1.025); }
  .card-cover::after { transition: transform 540ms var(--motion-ease); }
  .card:hover .card-cover::after { transform: translateX(115%); }
}
@media (prefers-reduced-motion: reduce) {
  .card, .card-cover-img { transition: none; }
}
</style>
