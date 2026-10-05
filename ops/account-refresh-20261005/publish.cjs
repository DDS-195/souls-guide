// Run in sg-server. Update only the ten generated accounts; archive originals privately.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const pool = require('/app/src/config/db')
const sharp = require('/app/node_modules/sharp')
const bytes=fs.readFileSync(path.join(__dirname,'payload.json')),payload=JSON.parse(bytes)
const sha=x=>crypto.createHash('sha256').update(x).digest('hex')
const mode=process.argv[2],expectedHash=process.argv[3],eventKey='editorial:'+payload.batch
const beforeFile=path.join(__dirname,'before.json'),receiptFile=path.join(__dirname,'receipt.json')
const imageRoot='/app/uploads/images/sg-account-avatars-20261005'
async function read(db,lock=false) {
  const [users]=await db.query("SELECT id,username,nickname,avatar,bio,role,apply_status,apply_reason,status,token_version,gender,DATE_FORMAT(birthday,'%Y-%m-%d') AS birthday,created_at,updated_at,SHA2(password,256) AS credential_fingerprint FROM users ORDER BY id"+(lock?' FOR UPDATE':''))
  return users
}
async function validate(db,users) {
  assert.equal(payload.batch,'account-refresh-20261005-v1');assert.equal(payload.users.length,10)
  assert.equal(new Set(payload.users.map(u=>u.id)).size,10);assert.equal(new Set(payload.users.map(u=>u.username)).size,10)
  const actor=users.find(u=>u.id===1&&u.username==='admin'&&u.role==='admin'&&u.status===1);assert.ok(actor)
  for(const u of payload.users) {
    const old=users.find(r=>r.id===u.id);assert.ok(old);assert.equal(old.username,u.expectedUsername);assert.equal(old.role,u.role);assert.equal(old.status,1)
    assert.ok(/^sg_demo_20260914_\d{2}$/.test(old.username));assert.ok(/^(creator|user)[2-8]$/.test(u.username))
    assert.ok(!users.some(r=>r.id!==u.id&&r.username.toLowerCase()===u.username.toLowerCase()),'username conflict')
    assert.equal(old.avatar,null,'account acquired a custom avatar; refresh the plan')
    assert.equal(u.avatar,`/uploads/images/sg-account-avatars-20261005/${u.username}.webp`);assert.equal(u.file,`${u.username}.webp`)
    const data=fs.readFileSync(path.join(imageRoot,u.file));assert.equal(sha(data),u.sha256);assert.equal(data.length,u.bytes)
    const metadata=await sharp(data).metadata();assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.format,'webp')
  }
  return actor
}
async function verify(db,receipt) {
  assert.equal(receipt.payloadSha256,expectedHash)
  const before=JSON.parse(fs.readFileSync(beforeFile,'utf8')),users=await read(db)
  for(const old of before.users) {
    const current=users.find(u=>u.id===old.id),update=payload.users.find(u=>u.id===old.id)
    assert.ok(current)
    if(update) {
      assert.equal(current.username,update.username);assert.equal(current.avatar,update.avatar);assert.equal(current.token_version,old.token_version+1)
      for(const key of ['id','nickname','bio','role','apply_status','apply_reason','status','gender','birthday','created_at','credential_fingerprint'])assert.equal(JSON.stringify(current[key]),JSON.stringify(old[key]),`unexpected change: ${old.id}/${key}`)
    } else assert.equal(JSON.stringify(current),JSON.stringify(old),'unrelated account changed')
  }
  return {accounts:10,creators:7,ordinaryUsers:3,passwordsRolesNicknamesPreserved:true,unrelatedAccountsPreserved:true}
}
async function main() {
  assert.ok(['plan','apply','verify'].includes(mode));assert.equal(sha(bytes),expectedHash)
  const db=await pool.getConnection();let transaction=false,locked=false
  try {
    const [[lock]]=await db.execute('SELECT GET_LOCK(?,5) AS acquired',[eventKey]);assert.equal(lock.acquired,1);locked=true
    const [[existing]]=await db.execute('SELECT metadata FROM operation_logs WHERE event_key=?',[eventKey])
    if(existing) {
      const receipt=typeof existing.metadata==='string'?JSON.parse(existing.metadata):existing.metadata
      console.log('ALREADY_APPLIED='+JSON.stringify({...receipt,verification:await verify(db,receipt)}));return
    }
    assert.notEqual(mode,'verify','batch not applied')
    await db.beginTransaction();transaction=true
    const users=await read(db,mode==='apply'),actor=await validate(db,users)
    if(mode==='plan') {
      fs.writeFileSync(beforeFile,JSON.stringify({batch:payload.batch,payloadSha256:expectedHash,plannedAt:new Date().toISOString(),users},null,2),{flag:'wx',mode:0o600})
      await db.rollback();transaction=false;console.log('PLAN_OK='+JSON.stringify({accounts:10,backup:beforeFile}));return
    }
    const before=JSON.parse(fs.readFileSync(beforeFile,'utf8'));assert.equal(before.payloadSha256,expectedHash)
    assert.equal(JSON.stringify(users),JSON.stringify(before.users),'account profiles changed after plan')
    for(const u of payload.users) {
      const [r]=await db.execute('UPDATE users SET username=?,avatar=?,token_version=token_version+1 WHERE id=? AND username=? AND role=?',[u.username,u.avatar,u.id,u.expectedUsername,u.role]);assert.equal(r.affectedRows,1)
    }
    const receipt={batch:payload.batch,payloadSha256:expectedHash,appliedAt:new Date().toISOString(),updated:payload.users.map(({id,expectedUsername,username,role,avatar})=>({id,previousUsername:expectedUsername,username,role,avatar}))}
    await db.execute('INSERT INTO operation_logs (admin_id,admin_username,action,method,path,target_type,detail,status,request_id,event_key,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[actor.id,actor.username,'demo_account_refresh','CLI','/ops/account-refresh/20261005','user','按站点所有者要求将生成账号改为 creator2–creator8、user2–user4，并分别设置网上选取的 CC0 头像；保留角色、密码、昵称和账号 ID；使旧用户名登录会话失效。',200,payload.batch,eventKey,JSON.stringify(receipt)])
    await db.commit();transaction=false
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
    console.log('ACCOUNTS_UPDATED='+JSON.stringify(receipt));console.log('VERIFY_OK='+JSON.stringify(await verify(db,receipt)))
  } catch(e) {if(transaction)await db.rollback();throw e}
  finally {if(locked)await db.execute('SELECT RELEASE_LOCK(?)',[eventKey]);db.release()}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>pool.end())
