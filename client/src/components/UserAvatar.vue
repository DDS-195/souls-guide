<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * UserAvatar — 统一头像组件（2026-08-16 组件复用改造）
 * 收编此前 8 处重复的「头像图片 + 首字母渐变兜底」逻辑（App/PostDetail/UserProfile/各管理页）。
 * 内置加载失败兜底：图片 404 时自动切换为用户名首字母 + 品牌渐变。
 * 用法：<UserAvatar :src="u.avatar" :name="u.nickname || u.username" :size="42" />
 */
const props = defineProps<{
  /** 头像 URL（可为空） */
  src?: string | null
  /** 兜底首字母来源（昵称/用户名） */
  name: string
  /** 直径 px，默认 42 */
  size?: number
}>()

const failed = ref(false)
// 换图（如列表复用实例、src 更新）时重置失败态，重新尝试加载新图
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
</script>

<template>
  <span
    class="ua"
    :style="{
      width: (size || 42) + 'px',
      height: (size || 42) + 'px',
      fontSize: Math.round((size || 42) * 0.4) + 'px',
      background:
        props.src && !failed
          ? `url(${props.src}) center/cover`
          : 'linear-gradient(135deg, var(--amber-dim), var(--amber))',
    }"
  >
    <span v-if="!props.src || failed" class="ua-fallback">{{ (name || '?').charAt(0) }}</span>
    <img v-else :src="props.src" alt="" class="ua-img" @error="failed = true" />
  </span>
</template>

<style scoped>
.ua {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  font-weight: 700;
  color: var(--bg-deep);
  vertical-align: middle;
}
.ua-fallback {
  display: inline-block;
  line-height: 1;
}
.ua-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
