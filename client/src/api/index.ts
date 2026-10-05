import { safeStorage } from '../utils/storage'
import request from '../utils/request'
import type {
  AdminStats,
  Announcement,
  ApiEnvelope,
  Comment,
  CreatorStats,
  CreatorApplication,
  CreatorStatsQuery,
  FollowUser,
  Game,
  LoginResult,
  MyPost,
  NotificationPage,
  OperationLog,
  PageQuery,
  PageResult,
  Post,
  PostListQuery,
  PostPayload,
  PostStatusResult,
  Report,
  ReviewPost,
  User,
  UserProfile,
} from '../types/api'

// ★契约源：本文件是前后端契约的代码化表现（R8），后端 AI 必须严格对齐；
// 2026-08-16 类型止血：全部函数标注泛型返回，契约字段进入编译器校验。

let meFlight: { token: string | null; promise: Promise<ApiEnvelope<User>> } | undefined
function getMe() {
  const token = safeStorage.getItem('token')
  if (meFlight?.token === token) return meFlight.promise
  const promise = request.get<ApiEnvelope<User>>('/users/me')
  meFlight = { token, promise }
  void promise.finally(() => { if (meFlight?.promise === promise) meFlight = undefined }).catch(() => {})
  return promise
}

export const userApi = {
  register: (data: { username: string; password: string }) =>
    request.post<ApiEnvelope<{ id: number }>>('/users/register', data),
  login: (data: { username: string; password: string }) => request.post<ApiEnvelope<LoginResult>>('/users/login', data),
  getMe,
  getProfile: (id: number) => request.get<ApiEnvelope<UserProfile>>(`/users/${id}`),
  updateProfile: (data: Partial<Pick<User, 'nickname' | 'bio' | 'gender' | 'birthday'>>) =>
    request.put<ApiEnvelope<null>>('/users/me', data),
  changePassword: (data: { current_password: string; new_password: string }) =>
    request.put<ApiEnvelope<null>>('/users/me/password', data),
  applyCreator: (reason: string) => request.post<ApiEnvelope<{ id: number }>>('/users/apply-creator', { reason }),
}

export const gameApi = {
  getList: (includeInactive = false) =>
    request.get<ApiEnvelope<Game[]>>('/games', { params: { include_inactive: includeInactive ? '1' : '0' } }),
  // 游戏管理（D15：归属 /api/games，auth+admin；后端已实现，2026-08-08 前端补声明对齐契约）
  create: (data: { name: string; description?: string; cover?: string | null; sort_order?: number }) =>
    request.post<ApiEnvelope<{ id: number }>>('/games', data),
  update: (
    id: number,
    data: {
      version: number
      name?: string
      description?: string
      cover?: string | null
      sort_order?: number
      status?: number
    },
  ) => request.put<ApiEnvelope<null>>(`/games/${id}`, data),
  remove: (id: number, version: number) => request.delete<ApiEnvelope<null>>(`/games/${id}`, { data: { version } }),
  sort: (data: { id: number; sort_order: number; version: number }[]) =>
    request.put<ApiEnvelope<null>>('/games/sort', data),
}

export const postApi = {
  // ids: 可选，逗号分隔按 id 批量取 published（2026-08-09 用户批准，历史卡片实时补齐用；公开不 +1 view_count，A2 实现）
  getList: (params?: PostListQuery, signal?: AbortSignal) => request.get<ApiEnvelope<PageResult<Post>>>('/posts', { params, signal }),
  getDetail: (id: number) => request.get<ApiEnvelope<Post>>(`/posts/${id}`),
  recordView: (id: number, visitorId: string) =>
    request.post<ApiEnvelope<{ counted: boolean; view_count: number }>>(`/posts/${id}/view`, { visitor_id: visitorId }),
  getManageDetail: (id: number) => request.get<ApiEnvelope<MyPost>>(`/posts/manage/${id}`),
  create: (data: PostPayload & { request_id: string }) => request.post<ApiEnvelope<{ id: number; content_version: number; status: Post['status']; replayed: boolean }>>('/posts', data),
  update: (id: number, data: PostPayload & { content_version: number }) =>
    request.put<ApiEnvelope<{ status: Post['status']; content_version: number }>>(`/posts/${id}`, data),
  remove: (id: number) => request.delete<ApiEnvelope<null>>(`/posts/${id}`),
  like: (id: number) => request.post<ApiEnvelope<{ liked: boolean; like_count: number }>>(`/posts/${id}/like`),
  favorite: (id: number) =>
    request.post<ApiEnvelope<{ favorited: boolean; favorite_count: number }>>(`/posts/${id}/favorite`),
  getStatus: (id: number) => request.get<ApiEnvelope<PostStatusResult>>(`/posts/${id}/status`),
  submit: (id: number) => request.post<ApiEnvelope<null>>(`/posts/${id}/submit`),
  getMyList: (params?: PageQuery) => request.get<ApiEnvelope<PageResult<MyPost>>>('/posts/my/list', { params }),
  getComments: (postId: number, params?: PageQuery & { parent_id?: number; focus_id?: number }) =>
    request.get<ApiEnvelope<PageResult<Comment>>>(`/posts/${postId}/comments`, { params }),
  addComment: (postId: number, data: { content: string; parent_id?: number | null }) =>
    request.post<ApiEnvelope<{ id: number }>>(`/posts/${postId}/comments`, data),
  replyComment: (commentId: number, content: string) =>
    request.post<ApiEnvelope<{ id: number }>>(`/comments/${commentId}/reply`, { content }),
  deleteComment: (commentId: number) =>
    request.delete<ApiEnvelope<{ comment_count: number }>>(`/comments/${commentId}`),
}

export const creatorApi = {
  getStats: (params?: CreatorStatsQuery) => request.get<ApiEnvelope<CreatorStats>>('/creator/stats', { params }),
}

export const interactApi = {
  getNotifications: (params?: PageQuery & { unread?: number; type?: string }) =>
    request.get<ApiEnvelope<NotificationPage>>('/notifications', { params }),
  getNotificationSummary: () => request.get<ApiEnvelope<{ unread: number; cutoff_id: number }>>('/notifications/summary'),
  getNotificationTarget: (id:number) => request.get<ApiEnvelope<{ path:string|null; message?:string }>>(`/notifications/${id}/target`),
  markAllRead: (cutoff_id:number, type?:string) => request.put<ApiEnvelope<{unread:number}>>('/notifications/read-all', {cutoff_id,type}),
  // 标记单条已读（契约 4.1 互动模块 PUT /notifications/:id/read，后端已实现，2026-08-09 前端补声明消费）
  markRead: (id: number) => request.put<ApiEnvelope<null>>(`/notifications/${id}/read`),
  getFavorites: (params?: PageQuery & { game_id?: number }, signal?: AbortSignal) => request.get<ApiEnvelope<PageResult<Post>>>('/favorites', { params, signal }),
  getFollowingFeed: (params?: PageQuery & { game_id?: number }, signal?: AbortSignal) => request.get<ApiEnvelope<PageResult<Post>>>('/following-feed', { params, signal }),
  follow: (id: number) => request.post<ApiEnvelope<{ following: boolean }>>(`/follows/${id}`),
  // 提交举报（2026-08-08 用户批准新增契约：POST /api/reports，auth，body {target_type, target_id, reason}；✅ 后端已实现，A1 已实现 UI 并实测）
  report: (data: { target_type: string; target_id: number; reason: string }) =>
    request.post<ApiEnvelope<{ id: number }>>('/reports', data),
  // 关注/粉丝列表（公开分页，2026-08-07 前端 MyLists 页消费登记）
  getFollowing: (id: number, params?: PageQuery, signal?: AbortSignal) =>
    request.get<ApiEnvelope<PageResult<FollowUser>>>(`/users/${id}/following`, { params, signal }),
  getFollowers: (id: number, params?: PageQuery, signal?: AbortSignal) =>
    request.get<ApiEnvelope<PageResult<FollowUser>>>(`/users/${id}/followers`, { params, signal }),
}

export const adminApi = {
  getPendingPosts: (params?: PageQuery) =>
    request.get<ApiEnvelope<PageResult<Post>>>('/admin/posts/pending', { params }),
  getReviewDetail: (id: number) => request.get<ApiEnvelope<ReviewPost>>(`/admin/posts/${id}/review`),
  approvePost: (id: number, content_version: number) =>
    request.put<ApiEnvelope<null>>(`/admin/posts/${id}/approve`, { content_version }),
  rejectPost: (id: number, reason: string, content_version: number) =>
    request.put<ApiEnvelope<null>>(`/admin/posts/${id}/reject`, { reason, content_version }),
  getApplications: (params?: PageQuery & { status?: 'pending' | 'processed' }) =>
    request.get<ApiEnvelope<PageResult<CreatorApplication>>>('/admin/applications', { params }),
  approveApplication: (id: number, application_id: number) =>
    request.put<ApiEnvelope<null>>(`/admin/applications/${id}/approve`, { application_id }),
  rejectApplication: (id: number, application_id: number, reason: string) =>
    request.put<ApiEnvelope<null>>(`/admin/applications/${id}/reject`, { application_id, reason }),
  getUsers: (params?: PageQuery & { role?: string; keyword?: string; status?: string }) =>
    request.get<ApiEnvelope<PageResult<User>>>('/admin/users', { params }),
  toggleBan: (id: number, data: { status: number; version: number; reason: string }) => request.put<ApiEnvelope<{ status: number; version: number }>>(`/admin/users/${id}/ban`, data),
  previewUserDeletion: (id: number) => request.get<ApiEnvelope<{ username: string; version: number; fingerprint: string; post_count: number; removed_comment_count: number; retained_comment_count: number; asset_count: number; announcement_count: number }>>(`/admin/users/${id}/deletion-preview`),
  deleteUser: (id: number, data: { username: string; fingerprint: string; reason: string }) =>
    request.delete<ApiEnvelope<{ deleted: number; username: string; post_count: number; comment_count: number }>>(
      `/admin/users/${id}`,
      { data },
    ),
  getAnnouncements: (params?: PageQuery & { status?: 'draft' | 'published' | 'archived' }) =>
    request.get<ApiEnvelope<PageResult<Announcement>>>('/admin/announcements', { params }),
  createAnnouncement: (data: { title: string; content: string }) =>
    request.post<ApiEnvelope<{ id: number; version: number }>>('/admin/announcements', data),
  updateAnnouncement: (id: number, data: { title: string; content: string; version: number }) =>
    request.put<ApiEnvelope<{ version: number }>>(`/admin/announcements/${id}`, data),
  cloneAnnouncement: (id: number) =>
    request.post<ApiEnvelope<{ id: number; version: number }>>(`/admin/announcements/${id}/clone`),
  publishAnnouncement: (id: number) =>
    request.put<ApiEnvelope<{ id: number; version: number }>>(`/admin/announcements/${id}/publish`),
  archiveAnnouncement: (id: number) => request.put<ApiEnvelope<{ id: number }>>(`/admin/announcements/${id}/archive`),
  deleteAnnouncement: (id: number) => request.delete<ApiEnvelope<{ id: number }>>(`/admin/announcements/${id}`),
  getReports: (params?: PageQuery & { status?: string }) =>
    request.get<ApiEnvelope<PageResult<Report>>>('/admin/reports', { params }),
  // 管理端游戏列表（含停用，auth+admin；2026-08-08 前端补声明对齐契约）
  getAdminGames: () => request.get<ApiEnvelope<Game[]>>('/admin/games'),
  resolveReport: (id: number, data: { status: string; handler_note?: string | null }) =>
    request.put<ApiEnvelope<null>>(`/admin/reports/${id}/resolve`, data),
  getStats: () => request.get<ApiEnvelope<AdminStats>>('/admin/stats'),
  // 操作日志（D23，2026-08-09 新增契约：GET /api/admin/logs，auth+admin，分页筛选 admin_id/action/keyword/start/end 均可选）
  getLogs: (
    params?: PageQuery & { admin_id?: number | string; action?: string; keyword?: string; start?: string; end?: string; request_id?: string; target_type?: string; target_id?: number | string },
  ) => request.get<ApiEnvelope<PageResult<OperationLog>>>('/admin/logs', { params }),
  previewNotification: (data: { scope: 'user' | 'all'; target_user_id: number | null }) =>
    request.post<ApiEnvelope<{ count: number; user: { id: number; username: string; nickname: string | null } | null }>>('/admin/notifications/preview', data),
  getNotificationHistory: (params: PageQuery) =>
    request.get<ApiEnvelope<PageResult<{ id: number; admin_username: string; scope: 'user' | 'all'; target_user_id: number | null; target_label: string | null; content: string; recipient_count: number; created_at: string }>>>('/admin/notifications', { params }),
  sendNotification: (data: { content: string; scope: 'user' | 'all'; target_user_id: number | null; request_id: string }) =>
    request.post<ApiEnvelope<{ id: number; count: number; replayed: boolean }>>('/admin/notifications', data),
}

export const announcementApi = {
  getLatest: () => request.get<ApiEnvelope<Announcement | null>>('/announcements/latest'),
  markRead: (id: number, version: number) => request.post<ApiEnvelope<null>>(`/announcements/${id}/read`, { version }),
}

// 视频接口单独超时：全局默认 15s 对分片/合并不适用（merge 需覆盖合并+FFmpeg 转码，≤15min）
const VIDEO_STATUS_TIMEOUT = 30 * 1000
const VIDEO_CHUNK_TIMEOUT = 60 * 1000
// 后端转码兜底 15min + 合并耗时余量 → 20min
const VIDEO_MERGE_TIMEOUT = 20 * 60 * 1000

export const mediaApi = {
  uploadImage: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return request.post<ApiEnvelope<{ url: string; asset_id: number }>>('/media/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  uploadAvatar: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return request.post<ApiEnvelope<{ url: string }>>('/users/me/avatar', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  // 已停用的旧入口：附属媒体返回409，需通过带版本的文章编辑移除；临时上传使用removeAsset。
  remove: (id: number) => request.delete<ApiEnvelope<null>>(`/media/${id}`),
  removeAsset: (assetId: number) => request.delete<ApiEnvelope<null>>(`/media/assets/${assetId}`),
  // 视频分片断点续传三接口（4.1 媒体模块，▲后端先行已实现，见 D12/D13）
  videoStatus: (hash: string, signal?: AbortSignal) =>
    request.post<ApiEnvelope<{ uploadedChunks: number[]; url: string | null; asset_id: number | null }>>(
      '/media/upload/video/status',
      { hash },
      { timeout: VIDEO_STATUS_TIMEOUT, signal },
    ),
  videoChunk: (hash: string, index: number, totalChunks: number, chunk: Blob, filename?: string, signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('hash', hash)
    fd.append('index', String(index))
    fd.append('totalChunks', String(totalChunks))
    // 必须带文件名：否则浏览器默认 filename="blob"，后端扩展名白名单落空 → 400（2026-08-07 修复，契约 4.1）
    fd.append('chunk', chunk, filename)
    return request.post<ApiEnvelope<{ index: number }>>('/media/upload/video/chunk', fd, {
      timeout: VIDEO_CHUNK_TIMEOUT,
      signal,
    })
  },
  videoMerge: (hash: string, totalChunks: number, originalName?: string, signal?: AbortSignal) =>
    request.post<ApiEnvelope<{ url: string; asset_id: number }>>(
      '/media/upload/video/merge',
      { hash, totalChunks, originalName },
      { timeout: VIDEO_MERGE_TIMEOUT, signal },
    ),
}
