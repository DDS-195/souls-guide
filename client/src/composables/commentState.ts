import type { InjectionKey } from 'vue'
import type { Comment } from '../types/api'
export interface CommentState {
  replying: boolean
  replyText: string
  replyPage: number
  loadedReplies: Comment[]
  replyTotal: number
  collapsed: boolean
}
// 由详情页提供，生命周期不超过当前文章；楼层刷新/收起不销毁草稿。
export const commentStateKey: InjectionKey<Map<number, CommentState>> = Symbol('comment-state')
