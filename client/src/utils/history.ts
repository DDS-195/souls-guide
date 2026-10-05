// 旧的共享 viewHistory 无法判定归属，不自动分配给任一账号。
export function historyKey(userId?: number | null) {
  return `viewHistory:${userId || 'guest'}`
}
