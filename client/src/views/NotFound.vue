<template>
  <section class="not-found">
    <p class="code">404</p>
    <h1>页面不存在</h1>
    <p>链接可能已失效，请检查地址或返回首页。</p>
    <router-link to="/" class="btn-primary">返回首页</router-link>
  </section>
</template>

<style scoped>
.not-found { padding: 64px 20px; text-align: center; color: var(--text-secondary); }
.code { color: var(--amber); font-size: 3rem; margin: 0; }
h1 { color: var(--text-primary); margin: 12px 0; }
a { display: inline-block; margin-top: 16px; }
</style>
