import { ref, computed } from 'vue'

/**
 * usePagination — 分页状态 composable（2026-08-16 组件复用改造）
 * 收编此前 5 份复制粘贴的 page/pageSize/total/pageCount/goPage 逻辑。
 * 用法：
 *   const { page, total, pageCount, pageSize, go } = usePagination(10)
 *   // 请求：{ page: page.value, pageSize }
 *   // 翻页：go(2)（自动校验边界与同页点击）
 */
export function usePagination(pageSize = 10) {
  const page = ref(1)
  const total = ref(0)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

  function reset() {
    page.value = 1
  }

  /** 翻页：越界/同页点击直接忽略，合法则更新 page 并返回 true（调用方据此触发 load） */
  function go(p: number): boolean {
    if (p < 1 || p > pageCount.value || p === page.value) return false
    page.value = p
    return true
  }

  return { page, total, pageCount, pageSize, reset, go }
}
