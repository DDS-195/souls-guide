/**
 * 轻量 toast 提示（3s 自动消失）
 * D13：自实现替代 el-message（D2 禁止新代码使用 Element Plus）
 * 颜色走 CSS 变量，双主题自动生效
 * 单实例复用：连续调用替换内容并重置计时——多条 toast 不再叠在同一位置互相覆盖
 * z-index 10001：高于全局弹窗（10000），管理端弹窗打开时提示仍可见
 */
let el: HTMLDivElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | undefined
let removeTimer: ReturnType<typeof setTimeout> | undefined

export function toast(message: string, type: 'info' | 'success' | 'error' = 'info') {
  if (!el) {
    el = document.createElement('div')
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:120px',
      'transform:translateX(-50%)',
      'background:var(--bg-card)',
      'color:var(--text-primary)',
      'border:1px solid var(--border-subtle)',
      'border-radius:var(--radius-md)',
      'padding:10px 18px',
      'font-size:0.85rem',
      'z-index:10001',
      'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
      'transition:opacity 0.25s ease',
      'max-width:80vw',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
    ].join(';')
    document.body.appendChild(el)
  }
  clearTimeout(hideTimer)
  clearTimeout(removeTimer)
  el.style.opacity = '1'
  el.style.borderColor = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--border-subtle)'
  el.textContent = message
  hideTimer = setTimeout(() => {
    if (el) el.style.opacity = '0'
  }, 3000)
  removeTimer = setTimeout(() => {
    el?.remove()
    el = null
  }, 3250)
}
