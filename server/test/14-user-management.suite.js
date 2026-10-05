const H = require('./helpers')
module.exports = async function () {
  const { test,http,pool,assert,mkUser,mkPost,makeToken } = H
  const token = await H.adminToken()
  const preview = async id => (await http('GET', `/admin/users/${id}/deletion-preview`, {token})).data.data
  const remove = async id => { const p = await preview(id); return http('DELETE', `/admin/users/${id}`, {token,body:{username:p.username,fingerprint:p.fingerprint,reason:'测试清理'}}) }
  await test('封禁旧版本重试不反向解封；解封后旧token仍无效', async () => {
    const uid = await mkUser('management_ban')
    const old = makeToken(uid,'management_ban','user')
    const body = {status:0,version:1,reason:'验证封禁'}
    const r = await Promise.all([http('PUT',`/admin/users/${uid}/ban`,{token,body}),http('PUT',`/admin/users/${uid}/ban`,{token,body})])
    assert.deepEqual(r.map(x=>x.status).sort(),[200,409])
    assert.equal((await pool.execute('SELECT status FROM users WHERE id=?',[uid]))[0][0].status,0)
    assert.equal((await http('PUT',`/admin/users/${uid}/ban`,{token,body:{status:1,version:2,reason:'验证解封'}})).status,200)
    assert.equal((await http('GET','/users/me',{token:old})).status,401)
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM user_management_events WHERE user_id=?',[uid]))[0][0].n,2)
  })
  await test('删除预览变化和错误用户名不能执行删除', async () => {
    const uid = await mkUser('management_impact',{role:'creator'})
    const p = await preview(uid)
    await mkPost(uid)
    assert.equal((await http('DELETE',`/admin/users/${uid}`,{token,body:{username:p.username,fingerprint:p.fingerprint,reason:'测试'}})).status,409)
    const newer = await preview(uid)
    assert.equal((await http('DELETE',`/admin/users/${uid}`,{token,body:{username:'wrong',fingerprint:newer.fingerprint,reason:'测试'}})).status,409)
  })
  await test('删除账号保留评论占位与他人回复，自己的文章仍删除', async () => {
    const owner = await mkUser('management_owner',{role:'creator'})
    const uid = await mkUser('management_removed',{role:'creator'})
    const childUser = await mkUser('management_reply')
    const post = await mkPost(owner,{status:'published'})
    const own = await mkPost(uid)
    const [root] = await pool.execute('INSERT INTO comments (user_id,post_id,content) VALUES (?,?,?)',[uid,post,'需要清除的正文'])
    const [child] = await pool.execute('INSERT INTO comments (user_id,post_id,content,parent_id) VALUES (?,?,?,?)',[childUser,post,'其他人的回复',root.insertId])
    assert.equal((await remove(uid)).status,200)
    const [[node]] = await pool.execute('SELECT * FROM comments WHERE id=?',[root.insertId])
    assert.equal(node.user_id,null); assert.equal(node.is_deleted,1); assert.equal(node.content,'[该评论已删除]')
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM comments WHERE id=?',[child.insertId]))[0][0].n,1)
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM posts WHERE id=?',[own]))[0][0].n,0)
    const svc = require('../src/services/interactService')
    const list = await svc.getComments(post,{page:1,pageSize:10})
    assert.ok(JSON.stringify(list).includes('其他人的回复'))
    await svc.replyComment(childUser,root.insertId,'可以继续讨论')
    await assert.rejects(()=>svc.deleteComment(root.insertId,post,owner),/占位/)
  })
  await test('未引用上传进入清理队列，失败保留并能重试', async () => {
    const uid = await mkUser('management_asset',{role:'creator'})
    const t = makeToken(uid,'management_asset','creator')
    const r = await http('POST','/media/upload/image',{token:t,form:H.pngForm('orphan.png')})
    assert.equal(r.status,200)
    const url = H.trackFile(r.data.data.url)
    assert.equal((await remove(uid)).status,200)
    H.expectFile(url,true)
    const media = require('../src/services/mediaService'), cleanup = require('../src/services/cleanupService')
    const original = media.unlinkUploads
    media.unlinkUploads = async()=>false
    try { await cleanup.cleanupUserAssets() } finally { media.unlinkUploads=original }
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM user_asset_cleanup WHERE url=?',[url]))[0][0].n,1)
    await cleanup.cleanupUserAssets(); H.expectFile(url,false)
  })
  await test('审计写入失败回滚账号删除', async () => {
    const uid = await mkUser('management_rollback')
    await pool.query("CREATE TRIGGER test_user_audit_failure BEFORE INSERT ON user_management_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'")
    try { assert.equal((await remove(uid)).status,500) } finally { await pool.query('DROP TRIGGER test_user_audit_failure') }
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM users WHERE id=?',[uid]))[0][0].n,1)
  })
  await test('普通用户不能预览删除；搜索支持ID和状态', async () => {
    const uid = await mkUser('management_search')
    const r = await http('GET',`/admin/users?keyword=${uid}&status=1`,{token})
    assert.ok(r.data.data.list.some(u=>u.id===uid))
    assert.equal((await http('GET',`/admin/users/${uid}/deletion-preview`,{token:makeToken(uid,'management_search','user')})).status,403)
    assert.equal((await http('GET','/admin/users?status=9',{token})).status,400)
  })
}
