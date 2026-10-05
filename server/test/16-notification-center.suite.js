const H=require('./helpers')
module.exports=async function(){
  const {test,http,mkUser,mkPost,makeToken,pool,assert}=H
  const owner=await mkUser('nc_owner',{role:'creator'}),reader=await mkUser('nc_reader')
  const token=makeToken(owner,'nc_owner','creator'),other=makeToken(reader,'nc_reader','user')
  const post=await mkPost(owner,{status:'published'})
  const list=async()=> (await http('GET','/notifications',{token})).data.data
  await test('通知上下文快照保留，类型筛选和只读概况有效',async()=>{
    await http('POST',`/posts/${post}/like`,{token:other})
    const first=(await list()).list[0]
    assert.ok(first.context_title)
    await pool.execute('UPDATE posts SET title=? WHERE id=?',['changed-title',post])
    assert.equal((await list()).list[0].context_title,first.context_title)
    const filtered=(await http('GET','/notifications?type=like&unread=1',{token})).data.data
    assert.equal(filtered.total,1)
    assert.equal((await http('GET','/notifications/summary',{token})).data.data.unread,1)
    assert.equal((await http('GET','/notifications?type=invalid',{token})).status,400)
    assert.equal((await http('GET','/notifications?unread=wrong',{token})).status,400)
  })
  await test('截止已读不吞新通知，类型范围不影响其他消息',async()=>{
    const before=await list()
    await http('POST',`/posts/${post}/comments`,{token:other,body:{content:'new comment'}})
    await http('PUT','/notifications/read-all',{token,body:{cutoff_id:before.cutoff_id,type:'like'}})
    const after=await list()
    assert.equal(after.list.find(n=>n.type==='like').is_read,1)
    assert.equal(after.list.find(n=>n.type==='comment').is_read,0)
    assert.equal(after.unread,1)
    assert.equal((await http('PUT','/notifications/read-all',{token,body:{cutoff_id:-1}})).status,400)
  })
  await test('关联评论解析页码且不能读取他人通知目标',async()=>{
    const n=(await list()).list.find(n=>n.type==='comment')
    assert.ok(n.comment_id)
    const target=(await http('GET',`/notifications/${n.id}/target`,{token})).data.data
    assert.ok(target.path.includes('comment_page=1'))
    assert.ok(target.path.endsWith('#comment-'+n.comment_id))
    assert.equal((await http('GET',`/notifications/${n.id}/target`,{token:other})).status,404)
    assert.equal((await http('GET',`/notifications/${n.id}/target`)).status,401)
    assert.equal((await list()).list.find(x=>x.id===n.id).is_read,0)
  })
  await test('删除评论后回退文章，文章不可见则禁用目标',async()=>{
    const n=(await list()).list.find(n=>n.type==='comment')
    await http('DELETE',`/comments/${n.comment_id}`,{token:other})
    assert.equal((await http('GET',`/notifications/${n.id}/target`,{token})).data.data.path,`/post/${post}`)
    await pool.execute("UPDATE posts SET status='draft' WHERE id=?",[post])
    assert.equal((await http('GET',`/notifications/${n.id}/target`,{token})).data.data.path,null)
    assert.equal((await list()).list.find(x=>x.id===n.id).target_available,0)
    await pool.execute("UPDATE posts SET status='published' WHERE id=?",[post])
  })
  await test('互动通知窗口外恢复提醒，窗口内不重复',async()=>{
    await http('POST',`/posts/${post}/like`,{token:other})
    await http('POST',`/posts/${post}/like`,{token:other})
    assert.equal((await list()).list.filter(n=>n.type==='like').length,1)
    await pool.execute("UPDATE notifications SET created_at=DATE_SUB(NOW(),INTERVAL 11 MINUTE) WHERE receiver_id=? AND type='like'",[owner])
    await http('POST',`/posts/${post}/like`,{token:other})
    await http('POST',`/posts/${post}/like`,{token:other})
    assert.equal((await list()).list.filter(n=>n.type==='like').length,2)
  })
  await test('通知单条已读非法编号被拒绝',async()=>{
    assert.equal((await http('PUT','/notifications/abc/read',{token})).status,400)
    assert.equal((await http('PUT','/notifications/0/read',{token})).status,400)
  })
}
