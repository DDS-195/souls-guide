const gameService = require('../services/gameService')
const response = require('../utils/response')
const { isLocalUploadUrl } = require('../services/assetService')
const integer = (v, min = 0) => Number.isInteger(v) && v >= min && v <= 2147483647
function validate(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '参数必须为对象'
  if (creating || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 50) return '游戏名不能为空且不能超过 50 字'
    body.name = body.name.trim()
  }
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) return '游戏描述必须为不超过 500 字的文本'
  if (body.cover !== undefined && body.cover !== null && (typeof body.cover !== 'string' || body.cover.length > 500 || !isLocalUploadUrl(body.cover))) return '封面必须为合法上传图片路径或 null'
  if (body.cover && !body.cover.startsWith('/uploads/images/')) return '封面必须为图片'
  if (body.sort_order !== undefined && !integer(body.sort_order)) return '排序值必须为非负整数'
  if (body.status !== undefined && ![0,1].includes(body.status)) return '状态只能为 0 或 1'
  if (!creating && !integer(body.version,1)) return '请刷新后携带有效游戏版本'
  if (!creating && !['name','description','cover','sort_order','status'].some(k=>body[k]!==undefined)) return '没有需要更新的字段'
  return null
}

// GET /api/games —— 公开列表（前端 Tab 用，仅启用）
async function getList(req, res) {
  if (req.query.include_inactive !== undefined && !['0','1'].includes(req.query.include_inactive)) return response.error(res, 'include_inactive 参数不合法')
  const games = await gameService.findAll(req.query.include_inactive === '1')
  response.success(res, games)
}

// POST /api/games —— 新增游戏（auth+admin，D15）
async function createGame(req, res) {
  const error = validate(req.body, true)
  if (error) return response.error(res,error)
  if (req.body.status !== undefined) return response.error(res,'新增游戏默认启用，请通过启停操作修改')
  try {
    const id = await gameService.create(req.body)
    response.success(res, { id }, '创建成功')
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return response.error(res, '游戏名已存在')
    throw err
  }
}

// PUT /api/games/:id —— 编辑游戏（auth+admin）
async function updateGame(req, res) {
  if (!/^\d+$/.test(req.params.id) || !integer(Number(req.params.id),1)) return response.error(res,'游戏 ID 不合法')
  const error = validate(req.body)
  if (error) return response.error(res,error)
  try {
    const affected = await gameService.update(req.params.id, req.body)
    if (!affected) return response.error(res, '游戏不存在', 404, 404)
    response.success(res, null, '更新成功')
  } catch (err) {
    // 2026-08-13 修复：改名撞唯一约束不再 500
    if (err.code === 'ER_DUP_ENTRY') return response.error(res, '游戏名已存在')
    throw err
  }
}

// DELETE /api/games/:id —— 删除游戏（auth+admin；RESTRICT：有文章不可删）
async function deleteGame(req, res) {
  if (!/^\d+$/.test(req.params.id) || !integer(Number(req.params.id),1) || !integer(req.body?.version,1)) return response.error(res,'请携带有效游戏 ID 和版本')
  try {
    const affected = await gameService.remove(req.params.id, req.body.version)
    if (!affected) return response.error(res, '游戏不存在', 404, 404)
    response.success(res, null, '删除成功')
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') return response.error(res, '该游戏下已有文章，不可删除')
    throw err
  }
}

// PUT /api/games/sort —— 批量排序（auth+admin）
async function sortGames(req, res) {
  const items = req.body
  if (!Array.isArray(items) || !items.length || items.length > 1000) return response.error(res, '参数应为 1–1000 项排序数组')
  // 2026-08-13：基本校验，非法项直接 400（旧实现静默吞掉）
  for (const it of items) {
    if (!it || !integer(it.id,1) || !integer(it.sort_order) || !integer(it.version,1)) {
      return response.error(res, '排序参数不合法（需为 [{id, sort_order}]）')
    }
  }
  const sorted = await gameService.sort(items)
  if (!sorted) return response.error(res, '排序列表包含重复或不存在的游戏', 400, 400)
  response.success(res, null, '排序已保存')
}

module.exports = { getList, createGame, updateGame, deleteGame, sortGames }
