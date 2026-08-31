<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()

defineProps<{
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
  }
}>()
function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>

<template>
  <article class="card" @click="router.push(`/post/${post.id}`)">
    <div class="card-cover">
      <img v-if="post.cover" class="card-cover-img" :src="post.cover" alt="" loading="lazy" />
      <span v-else class="cover-placeholder">{{ post.icon }}</span>
      <div class="card-badges">
        <span v-if="post.game" class="badge badge-game">{{ post.game }}</span>
        <span v-if="post.category" class="badge badge-category">{{ post.category }}</span>
      </div>
    </div>
    <div class="card-body">
      <h3 class="card-title">{{ post.title }}</h3>
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
        <span>{{ post.time }}</span>
      </div>
      <div class="card-bottom">
        <router-link v-if="post.user_id" :to="`/user/${post.user_id}`" class="card-author" @click.stop>
          <img v-if="post.avatar" class="author-avatar" :src="post.avatar" alt="" loading="lazy" />
          <span v-else class="author-avatar author-avatar--fallback"></span>
          {{ post.author }}
        </router-link>
        <div v-else class="card-author">
          <img v-if="post.avatar" class="author-avatar" :src="post.avatar" alt="" loading="lazy" />
          <span v-else class="author-avatar author-avatar--fallback"></span>
          {{ post.author }}
        </div>
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
  transition: all 250ms;
  display: flex;
  flex-direction: column;
}
.card:hover {
  border-color: var(--border-hover);
  box-shadow: 0 4px 20px var(--amber-glow);
}
.card-cover {
  position: relative;
  aspect-ratio: 16/9;
  background: linear-gradient(135deg, var(--bg-hover), var(--bg-card));
  overflow: hidden;
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
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-badges {
  position: absolute;
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
</style>
