<template>
  <div class="skeleton-card" aria-hidden="true">
    <div class="skeleton-cover" />
    <div class="skeleton-body">
      <div class="skeleton-title"><i /><i /></div>
      <div class="skeleton-tags"><i /><i /></div>
      <div class="skeleton-meta"><i /><i /></div>
      <div class="skeleton-author"><i /><i /></div>
    </div>
  </div>
</template>
<style scoped>
.skeleton-card { min-width:0; overflow:hidden; border:1px solid var(--border-subtle); border-radius:10px; background:var(--bg-card); }
.skeleton-cover { aspect-ratio:2; background:var(--bg-hover); }
.skeleton-body { padding:14px 16px; }
i { display:block; border-radius:4px; background:var(--bg-hover); }
.skeleton-title { height:2.8em; font-size:.95rem; margin-bottom:6px; display:grid; align-content:start; gap:8px; }
.skeleton-title i { height:13px; }.skeleton-title i:last-child { width:72%; }
.skeleton-tags { height:22px; margin-bottom:8px; display:flex; gap:6px; }.skeleton-tags i { width:58px; height:18px; }
.skeleton-meta { height:34px; display:grid; gap:6px; }.skeleton-meta i { height:12px; width:65%; }.skeleton-meta i:last-child { width:30%; }
.skeleton-author { height:30px; padding-top:8px; display:flex; align-items:center; gap:6px; }.skeleton-author i:first-child { width:22px; height:22px; border-radius:50%; }.skeleton-author i:last-child { width:80px; height:12px; }
@media(max-width:767px) {
  .skeleton-cover { aspect-ratio:2.5; }
  .skeleton-body { padding:10px 12px; }
  .skeleton-tags { height:20px; margin-bottom:6px; }
  .skeleton-meta { height:18px; display:flex; align-items:center; gap:16px; }
  .skeleton-meta i, .skeleton-meta i:last-child { width:25%; }
  .skeleton-author { height:28px; padding-top:6px; }
}
</style>
