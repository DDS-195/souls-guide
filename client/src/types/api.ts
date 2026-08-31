/**
 * SoulsGuide 业务类型定义（2026-08-16 工程化改造 · 类型止血）
 * 权威来源：SoulsGuide-设计文档.md 第 3 章（表结构）与第 4 章（API 契约）
 * 目的：替换全项目 `any`，让契约进入编译器——后端改字段时前端在 vue-tsc 阶段立即报错
 * 命名约定：字段名与后端响应严格一致（snake_case），不转换；枚举值取自 schema.sql 的 ENUM 定义
 */

// ================= 通用 =================

/** 统一响应信封（设计文档 4.0，request.ts 拦截器返回的完整对象） */
export interface ApiEnvelope<T = unknown> {
  code: number
  message: string
  data: T
}

/** 分页响应（4.0 分页列表格式） */
export interface PageResult<T> {
  total: number
  page: number
  pageSize: number
  list: T[]
}

/** 分页查询参数 */
export interface PageQuery {
  page?: number
  pageSize?: number
}

// ================= 用户（3.1 users） =================

export type UserRole = 'user' | 'creator' | 'admin'
export type ApplyStatus = 'none' | 'pending' | 'approved' | 'rejected'

/** 用户完整信息（GET /users/me） */
export interface User {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  bio: string | null
  gender: string | null
  birthday: string | null
  role: UserRole
  apply_status: ApplyStatus
  status: number
  created_at?: string
  updated_at?: string
}

/** 他人主页响应（GET /users/:id，4.1 用户模块，D19 起含 is_followed） */
export interface UserProfile extends User {
  post_count: number
  follower_count: number
  following_count: number
  is_followed?: boolean
}

/** 登录响应（POST /users/login） */
export interface LoginResult {
  token: string
  username: string
  role: UserRole
}

/** 关注/粉丝列表项（GET /users/:id/following|followers） */
export interface FollowUser {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  followed_at?: string
}

// ================= 游戏（3.2 games） =================

export interface Game {
  id: number
  name: string
  cover: string | null
  description: string | null
  sort_order: number
  status: number
  created_at?: string
  updated_at?: string
}

// ================= 文章（3.3 posts） =================

export type PostStatus = 'draft' | 'pending' | 'published' | 'rejected'

/** 媒体资源（3.8 media，仅详情/我的列表返回） */
export interface MediaItem {
  id: number
  url: string
  type: 'image' | 'video'
  sort_order: number
}

/** 文章（列表/详情，列表无 content/media） */
export interface Post {
  id: number
  title: string
  content?: string
  cover: string | null
  game_id: number
  game_name?: string
  category: string
  status: PostStatus
  reject_reason?: string | null
  view_count: number
  like_count: number
  comment_count: number
  user_id: number
  username?: string
  avatar?: string | null
  tags?: string[]
  media?: MediaItem[]
  created_at?: string
  updated_at?: string
}

/** 我的文章列表项（GET /posts/my/list，方案 A 起每项含 content/tags/media（video）——编辑回填数据源） */
export interface MyPost extends Post {
  content: string
  tags: string[]
  media: MediaItem[]
}

/** 文章互动状态（GET /posts/:id/status，D17） */
export interface PostStatusResult {
  liked: boolean
  favorited: boolean
  is_followed: boolean
}

/** 文章创建/编辑 body（4.1 文章模块，status 不接受请求体，传了也无副作用） */
export interface PostPayload {
  title: string
  content: string
  game_id: number
  category: string
  status?: 'draft' | 'pending'
  tags: string[]
  video: string | null
  cover: string | null
}

/** 文章列表查询参数（GET /posts，4.1：game_id/category/tag_id/keyword/user_id/ids/sort + 分页） */
export interface PostListQuery extends PageQuery {
  game_id?: number | string
  category?: string
  tag_id?: number | string
  keyword?: string
  user_id?: number
  ids?: string
  sort?: 'latest' | 'hot'
}

// ================= 评论（3.9 comments，嵌套树） =================

export interface Comment {
  id: number
  content: string
  user_id: number
  post_id: number
  parent_id: number | null
  created_at?: string
  username?: string
  nickname?: string | null
  avatar?: string | null
  replies: Comment[]
}

// ================= 通知（3.6 notifications） =================

export type NotificationType = 'like' | 'comment' | 'reply' | 'follow' | 'audit' | 'system'

export interface Notification {
  id: number
  receiver_id: number
  sender_id: number | null
  type: NotificationType
  target_type: string | null
  target_id: number | null
  content: string
  is_read: number
  created_at?: string
  username?: string | null
  nickname?: string | null
  avatar?: string | null
}

/** 通知分页响应（4.1：分页字段之外额外含 unread 未读数） */
export interface NotificationPage extends PageResult<Notification> {
  unread: number
}

// ================= 举报（3.7 reports） =================

export type ReportTargetType = 'post' | 'user' | 'comment'
export type ReportStatus = 'pending' | 'resolved' | 'dismissed'

export interface Report {
  id: number
  reporter_id: number
  target_type: ReportTargetType
  target_id: number
  reason: string
  status: ReportStatus
  handler_id: number | null
  handler_note: string | null
  created_at?: string
  updated_at?: string
}

// ================= 公告（3.13 announcements） =================

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export interface Announcement {
  id: number
  title: string
  content: string
  author_id: number
  status: AnnouncementStatus
  created_at?: string
  updated_at?: string
}

// ================= 操作日志（3.14 operation_logs） =================

export interface OperationLog {
  id: number
  admin_id: number
  admin_username: string
  action: string
  method: string
  path: string
  target_type: string | null
  target_id: number | null
  detail: string | null
  ip: string | null
  status: number
  created_at?: string
}

// ================= 统计 =================

/** 创作者统计（GET /creator/stats，4.1 创作者统计契约） */
export interface CreatorStats {
  overview: {
    post_count: number
    view_count: number
    like_count: number
    comment_count: number
    favorite_count: number
    follower_count: number
  }
  trend: { date: string; views: number; likes: number; comments: number }[]
  top_posts: { id: number; title: string; view_count: number; like_count: number }[]
  category_dist: { category: string; count: number }[]
}

/** 全站统计（GET /admin/stats） */
export interface AdminStats {
  totalUsers: number
  totalPosts: number
  totalViews: number
}

// ================= 前端本地数据结构 =================

/** 浏览历史本地快照（PostDetail 写入 localStorage viewHistory，2026-08-09 卡片化方案） */
export interface HistorySnapshot {
  id: number
  title: string
  time: string
  cover: string | null
  game_id: number
  game_name?: string
  category: string
  tags: string[]
  view_count: number
  like_count: number
  comment_count: number
  username: string
  user_id: number
  avatar: string | null
}
