import { readonly, ref } from 'vue'

function readPreference() {
  try {
    return localStorage.getItem('theme') !== 'light'
  } catch {
    return true
  }
}
const isDark = ref(readPreference())
let restoreFrame = 0
function apply(dark: boolean) {
  const root = document.documentElement
  cancelAnimationFrame(restoreFrame)
  root.classList.add('theme-switching')
  isDark.value = dark
  root.classList.toggle('light-theme', !dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.style.removeProperty('background-color')
  // 留出一帧，让 Vue 更新的主题样式也在禁用过渡期间提交。
  restoreFrame = requestAnimationFrame(() => {
    restoreFrame = requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
      restoreFrame = 0
    })
  })
}
apply(isDark.value)

function setDark(dark: boolean) {
  apply(dark)
  // 禁用存储或配额耗尽时，当前页面仍可切换。
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  } catch {
    /* 仅不保存偏好 */
  }
}
function onStorage(event: StorageEvent) {
  if (event.key === 'theme' || event.key === null) apply(readPreference())
}
window.addEventListener('storage', onStorage)
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('storage', onStorage)
  cancelAnimationFrame(restoreFrame)
  document.documentElement.classList.remove('theme-switching')
})

export function useTheme() {
  return { isDark: readonly(isDark), setDark, toggle: () => setDark(!isDark.value) }
}
