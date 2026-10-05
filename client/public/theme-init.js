// 在应用和样式加载前恢复主题，避免浅色用户先看到深色背景。
;(function () {
  var dark = true
  try {
    dark = localStorage.getItem('theme') !== 'light'
  } catch (_) {}
  document.documentElement.classList.toggle('light-theme', !dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.style.backgroundColor = dark ? '#0a0e14' : '#f5f0e8'
})()
