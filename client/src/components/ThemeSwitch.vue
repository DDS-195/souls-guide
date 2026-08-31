<script setup lang="ts">
import { ref } from 'vue'
import { useTheme } from '../utils/theme'

const { isDark, toggle } = useTheme()
const visible = ref(false)

function setDark(v: boolean) {
  if (v !== isDark.value) toggle()
  visible.value = false
}
function open() {
  visible.value = true
}
defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ts-overlay" @click.self="visible = false">
      <div class="ts-card">
        <div class="ts-option" @click="setDark(true)">打开</div>
        <div class="ts-option" @click="setDark(false)">关闭</div>
        <div class="ts-cancel" @click="visible = false">取消</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ts-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.ts-card {
  background: var(--bg-card, #1a1f26);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 12px;
  width: 100%;
  max-width: 220px;
  overflow: hidden;
}
.ts-option {
  padding: 12px 16px;
  font-size: 0.9rem;
  color: var(--text-primary, #e2e8f0);
  cursor: pointer;
  text-align: center;
  transition: background 150ms;
}
.ts-option:hover {
  background: var(--bg-hover, #1e242c);
}
.ts-option:first-child {
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
.ts-cancel {
  padding: 10px 16px;
  font-size: 0.82rem;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  text-align: center;
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
</style>
