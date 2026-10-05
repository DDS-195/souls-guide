// D23 自动审计中间件：挂载在已鉴权（auth 通过、req.user 就绪）的路由层，
// 只记录 2xx 成功的管理写操作（POST/PUT/DELETE）；GET 跳过；失败/越权请求不记（排障走错误日志）。
// 规则表按「挂载点内相对路径」匹配（admin.js 内 /posts/3/approve；games.js 内 / 或 /3）；
// desc 优先取规则映射（可引用请求体 body 与响应体 logBody），未命中回退 `METHOD path`。
// 服务在业务事务内写入审计；审计失败必须回滚业务。finish 仅检查遗漏，不补写。
const logService = require('../services/logService')

const s = (v, max) => (v == null ? null : String(v).slice(0, max))

const ADMIN_RULES = [
  { re: /^\/posts\/(\d+)\/approve$/, action: 'approve_post', target: 'post', desc: (m) => `审核通过文章 #${m[1]}` },
  { re: /^\/posts\/(\d+)\/reject$/, action: 'reject_post', target: 'post', desc: (m, b) => `驳回文章 #${m[1]}${b && b.reason ? '：' + s(b.reason, 60) : ''}` },
  { re: /^\/applications\/(\d+)\/approve$/, action: 'approve_application', target: 'user', desc: (m) => `通过创作者申请（用户 #${m[1]}）` },
  { re: /^\/applications\/(\d+)\/reject$/, action: 'reject_application', target: 'user', desc: (m) => `驳回创作者申请（用户 #${m[1]}）` },
  { re: /^\/reports\/(\d+)\/resolve$/, action: 'resolve_report', target: 'report', desc: (m, b) => `处理举报 #${m[1]}（${b && b.status === 'resolved' ? '属实' : b && b.status === 'dismissed' ? '不属实' : b && b.status ? s(b.status, 20) : '未知'}）` },
  { re: /^\/users\/(\d+)\/ban$/, action: 'ban_user', target: 'user', desc: (m, b, logBody) => `封禁/解封用户 #${m[1]}${logBody && logBody.message ? '（' + logBody.message + '）' : ''}` },
  { re: /^\/users\/(\d+)$/, method: 'DELETE', action: 'delete_user', target: 'user', desc: (m, b, logBody) => `删除用户${logBody && logBody.data ? '「' + s(logBody.data.username, 40) + '」' : ' #' + m[1]}${logBody && logBody.data ? `（文章 ${logBody.data.post_count} 篇，评论 ${logBody.data.comment_count} 条）` : ''}` },
  { re: /^\/announcements$/, method: 'POST', action: 'create_announcement', target: 'announcement', desc: (m, b) => `创建公告${b && b.title ? '「' + s(b.title, 40) + '」' : ''}` },
  { re: /^\/announcements\/(\d+)$/, method: 'PUT', action: 'update_announcement', target: 'announcement', desc: (m, b) => `编辑公告 #${m[1]}${b && b.title ? '→「' + s(b.title, 40) + '」' : ''}` },
  { re: /^\/announcements\/(\d+)\/clone$/, method: 'POST', action: 'clone_announcement', target: 'announcement', desc: (m) => `复制公告 #${m[1]} 为新草稿` },
  { re: /^\/announcements\/(\d+)\/publish$/, action: 'publish_announcement', target: 'announcement', desc: (m) => `发布公告 #${m[1]}` },
  { re: /^\/announcements\/(\d+)\/archive$/, action: 'archive_announcement', target: 'announcement', desc: (m) => `归档公告 #${m[1]}` },
  { re: /^\/announcements\/(\d+)$/, method: 'DELETE', action: 'delete_announcement', target: 'announcement', desc: (m) => `删除公告 #${m[1]}` },
  { re: /^\/notifications$/, action: 'send_notification', target: 'notification', desc: (m, b) => `发送系统通知（${b && b.target_user_id ? '定向用户 #' + b.target_user_id : '全员'}）${b && b.content ? '：「' + s(b.content, 40) + '」' : ''}` },
]

const GAME_RULES = [
  { re: /^\/$/, method: 'POST', action: 'create_game', target: 'game', desc: (m, b) => `创建游戏${b && b.name ? '「' + s(b.name, 40) + '」' : ''}` },
  { re: /^\/sort$/, action: 'sort_games', target: 'game', desc: () => '游戏排序' },
  { re: /^\/(\d+)$/, method: 'PUT', action: 'update_game', target: 'game', desc: (m, b) => `编辑游戏 #${m[1]}${b && b.name ? '→「' + s(b.name, 40) + '」' : ''}` },
  { re: /^\/(\d+)$/, method: 'DELETE', action: 'delete_game', target: 'game', desc: (m) => `删除游戏 #${m[1]}` },
]

// 同一路径的 PUT/DELETE 规则靠 method 区分：无 method 的规则匹配所有方法，
// 故同路径多方法时必须显式声明 method（见 announcements/(\d+) 的 PUT/DELETE 两条）
function matchRule(rules, method, relPath) {
  for (const rule of rules) {
    if (rule.method && rule.method !== method) continue
    const m = rule.re.exec(relPath)
    if (m) return { rule, m }
  }
  return null
}

function createLogMiddleware(rules) {
  return (req, res, next) => {
    if (!['POST','PUT','DELETE','PATCH'].includes(req.method)) return next()
    const hit = matchRule(rules, req.method, req.path)
    if (!hit) return next()
    const { rule, m } = hit
    const audit = require('../utils/auditContext')
    const current = {
      recorded: false,
      record: async (db, data = {}, overrides = {}) => {
        const action = rule.action === 'ban_user' && data.status === 1 ? 'unban_user' : rule.action
        const detail = rule.action === 'ban_user'
          ? (data.status === 0 ? '封禁' : '解封') + '用户 #' + m[1] + '：' + s(req.body?.reason,300)
          : rule.desc(m, req.body, { data, message: '' })
        await logService.log({
          admin_id: req.user.id, admin_username: s(req.user.username,50),
          action, method: req.method, path: s(req.originalUrl.split('?')[0],200),
          target_type: rule.target, target_id: m[1] ? Number(m[1]) : data.id || null,
          detail: s(detail,500), ip: s(req.ip,45), status: 200,
          request_id: req.id || null,
          metadata: { reason: s(req.body?.reason || req.body?.handler_note,300), ...data },
          ...overrides,
        }, db)
      },
    }
    // 成功业务应在事务内调用 record；这里仅检测遗漏，不把失败伪装成成功审计。
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && !current.recorded)
        console.error('[audit] 未记录的成功管理操作:', req.id, req.method, req.originalUrl.split('?')[0])
    })
    audit.context.run(current, next)
  }
}

module.exports = { createLogMiddleware, ADMIN_RULES, GAME_RULES }
