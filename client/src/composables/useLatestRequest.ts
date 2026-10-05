import { ref, onScopeDispose } from 'vue'

/**
 * useLatestRequest — 请求序号防竞态 composable（2026-08-16 组件复用改造）
 * 收编此前在 4 个文件复制 4 遍的 loadSeq 模式（Home/Search/MyLists/UserProfile）：
 * 快速连续操作（切 Tab/搜索/切用户）时，旧请求响应后到会被序号比对丢弃，不再覆盖新结果。
 * 用法：
 *   const { next, isLatest } = useLatestRequest()
 *   async function load() {
 *     const seq = next()
 *     const data = await api.xxx()
 *     if (!isLatest(seq)) return
 *     ...
 *   }
 */
export function useLatestRequest() {
  const seq = ref(0)
  let controller = new AbortController()
  onScopeDispose(() => { seq.value++; controller.abort() })

  /** 发起新请求：递增序号并返回本次请求的代号 */
  function next(): number {
    controller.abort()
    controller = new AbortController()
    return ++seq.value
  }

  /** 本次请求是否仍是最新意图（不是则响应已过期，调用方应直接丢弃） */
  function isLatest(s: number): boolean {
    return s === seq.value
  }

  return { seq, next, isLatest, signal: () => controller.signal }
}
