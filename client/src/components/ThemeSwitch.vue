<script setup lang="ts">
import { ref } from 'vue'
import { useTheme } from '../utils/theme'
import AppModal from './AppModal.vue'

const { isDark, setDark } = useTheme()
const visible = ref(false)
function choose(dark: boolean) {
  setDark(dark)
  visible.value = false
}
defineExpose({
  open: () => {
    visible.value = true
  },
})
</script>

<template>
  <AppModal :open="Boolean(visible)" title="显示模式" max-width="280px" @close="visible = false"><template v-if="visible">
    <div class="theme-options" role="group" aria-label="选择显示模式">
      <button type="button" :aria-pressed="isDark" @click="choose(true)">深色 <span v-if="isDark">✓ 当前</span></button>
      <button type="button" :aria-pressed="!isDark" @click="choose(false)">
        浅色 <span v-if="!isDark">✓ 当前</span>
      </button>
    </div>
    <button type="button" class="cancel" @click="visible = false">取消</button>
  </template></AppModal>
</template>

<style scoped>
.theme-options {
  display: grid;
  gap: 8px;
}
button {
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  font: inherit;
  font-size: 0.88rem;
  color: var(--text-primary);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
}
button[aria-pressed='true'] {
  border-color: var(--amber);
}
button span {
  float: right;
  color: var(--text-secondary);
  font-size: 0.78rem;
}
button:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}
.cancel {
  margin-top: 12px;
  text-align: center;
  color: var(--text-secondary);
  background: transparent;
}
</style>
