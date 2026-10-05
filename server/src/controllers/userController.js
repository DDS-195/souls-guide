// 2026-08-13 换用 native bcrypt（用户批准，R2 例外）：bcryptjs 纯 JS 同步实现会阻塞事件循环，
// native bcrypt 走 libuv 线程池，高并发登录不再卡全局（见 SoulsGuide-并发与高可用评估文档.md B1）
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const userService = require('../services/userService')
const response = require('../utils/response')
const { validateImageFile } = require('../utils/mediaValidation')

function isObjectBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
}

function validateCredentials(body, registration = false) {
  if (!isObjectBody(body) || typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username.trim() || !body.password) {
    return '用户名和密码必须为非空文本'
  }
  if (body.username.length > 50) return '用户名不能超过 50 字符'
  if (registration && body.password.length < 6) return '密码至少6位'
  if (body.password.length > 72) return '密码不能超过 72 字符'
  return null
}

function validBirthday(value) {
  if (value === null || value === '') return true // 明确清空生日，不把错误输入转换成 NULL。
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return day <= days[month - 1] && value <= today
}

async function getMe(req, res) {
  const user = await userService.findById(req.user.id)
  if (!user) return response.error(res, '用户不存在', 404, 404)
  user.application = await require('../services/applicationService').latest(req.user.id)
  response.success(res, user)
}

async function register(req, res) {
  const validation = validateCredentials(req.body, true)
  if (validation) return response.error(res, validation)
  const { username, password } = req.body

  const existing = await userService.findByUsername(username)
  if (existing) {
    return response.error(res, '用户名已存在', 409, 409)
  }

  const hashed = await bcrypt.hash(password, 10)
  try {
    const id = await userService.create({ username, password: hashed })
    response.success(res, { id }, '注册成功')
  } catch (err) {
    // 查重与 INSERT 之间可能有另一请求创建同名账号，唯一约束是最终裁决。
    if (err.code === 'ER_DUP_ENTRY') return response.error(res, '用户名已存在', 409, 409)
    throw err
  }
}

async function login(req, res) {
  const validation = validateCredentials(req.body)
  if (validation) return response.error(res, validation)
  const { username, password } = req.body

  const user = await userService.findByUsername(username)
  // 2026-08-13 修复（P2-7）：用户不存在与密码错误统一文案，堵住用户名枚举
  if (!user) {
    return response.error(res, '用户名或密码错误', 401, 401)
  }
  if (user.status === 0) {
    return response.error(res, '账号已被封禁', 403, 403)
  }

  const match = await bcrypt.compare(password, user.password)
  if (!match) {
    return response.error(res, '用户名或密码错误', 401, 401)
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, ver: user.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  require('../utils/mediaSession').issue(res, user)
  response.success(res, { token, username: user.username, role: user.role }, '登录成功')
}

async function changePassword(req, res) {
  const { current_password, new_password } = req.body || {}
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return response.error(res, '当前密码和新密码不能为空')
  }
  if (new_password.length < 8 || new_password.length > 72) {
    return response.error(res, '新密码须为 8~72 个字符')
  }
  if (new_password === current_password) return response.error(res, '新密码不能与当前密码相同')
  const credentials = await userService.findCredentialsById(req.user.id)
  if (!credentials || !(await bcrypt.compare(current_password, credentials.password))) {
    return response.error(res, '当前密码错误', 400, 400)
  }
  const hashed = await bcrypt.hash(new_password, 12)
  await userService.changePassword(req.user.id, hashed)
  response.success(res, null, '密码已修改，请重新登录')
}

async function applyCreator(req, res) {
  const reason = req.body?.reason
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) return response.error(res, '请填写 1–500 字的申请理由')
  const result = await require('../services/applicationService').submit(req.user.id, reason.trim())
  if (result === 'missing') return response.error(res, '用户不存在', 404, 404)
  if (result === 'banned') return response.error(res, '账号已被封禁', 403, 403)
  if (result === 'role') return response.error(res, '你已是创作者或管理员')
  if (result === 'pending') return response.error(res, '申请审核中，请耐心等待')
  response.success(res, result, '申请已提交，等待管理员审核')
}

async function uploadAvatar(req, res) {
  if (!req.file) return response.error(res, '请选择图片')
  await validateImageFile(req.file)
  const result = await userService.uploadAvatar(req.user.id, req.file)
  if (result.duplicate) return response.error(res, '与当前头像重复', 400, 400)
  response.success(res, { url: result.url }, '上传成功')
}

async function updateProfile(req, res) {
  if (!isObjectBody(req.body)) return response.error(res, '个人资料格式错误')
  const { nickname, bio, gender, birthday } = req.body
  for (const [field, value] of Object.entries({ nickname, bio, gender })) {
    if (value !== undefined && value !== null && typeof value !== 'string') return response.error(res, `${field} 必须为文本或 null`)
  }
  if (nickname && (nickname.length < 2 || nickname.length > 20)) {
    return response.error(res, '昵称需2~20个字符')
  }
  // 2026-08-13 修复（P1-1）：bio/gender 超长直插 DB 会 500
  if (bio && bio.length > 200) {
    return response.error(res, '个人简介不能超过 200 字')
  }
  if (gender && gender.length > 10) {
    return response.error(res, '性别字段不合法')
  }
  if (birthday !== undefined && !validBirthday(birthday)) return response.error(res, '生日须为不晚于今天的有效日期（YYYY-MM-DD），或留空')
  await userService.updateProfile(req.user.id, { nickname, bio, gender, birthday })
  response.success(res, null, '保存成功')
}

// GET /api/users/:id —— 他人主页（文章数/粉丝数/关注数；携带有效 token 时含 is_followed，D19）
async function getProfile(req, res) {
  const id = +req.params.id
  if (!Number.isInteger(id) || id < 1) return response.error(res, '用户不存在', 404, 404)
  const profile = await userService.getProfile(id, req.user ? req.user.id : null)
  if (!profile) return response.error(res, '用户不存在', 404, 404)
  response.success(res, profile)
}

module.exports = { register, login, changePassword, getMe, applyCreator, uploadAvatar, updateProfile, getProfile }
