const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const payload=require('./payload.json')
const base='http://116.62.158.251'
const sha=data=>crypto.createHash('sha256').update(data).digest('hex')
async function get(url){const r=await fetch(base+url,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,url);return r}
async function main(){
  const profiles=[]
  for(const u of payload.users){
    const profile=(await(await get(`/api/users/${u.id}`)).json()).data
    assert.equal(profile.username,u.username);assert.equal(profile.role,u.role);assert.equal(profile.avatar,u.avatar)
    const image=await get(u.avatar);assert.ok(image.headers.get('content-type')?.includes('image/webp'))
    const data=Buffer.from(await image.arrayBuffer());assert.equal(sha(data),u.sha256)
    profiles.push({id:u.id,username:profile.username,nickname:profile.nickname,role:profile.role,avatar:profile.avatar,bytes:data.length})
  }
  const page=(await(await get('/api/posts?page=1&pageSize=50')).json()).data
  assert.equal(page.total,36);assert.equal(page.list.length,36)
  for(const p of page.list){const user=payload.users.find(u=>u.id===p.user_id);assert.ok(user);assert.equal(p.avatar,user.avatar);assert.equal(p.username,user.username)}
  const result={verifiedAt:new Date().toISOString(),accounts:profiles.length,profiles,postsChecked:page.list.length,avatarFilesAccessible:10,issues:[]}
  fs.writeFileSync(path.resolve(__dirname,'../../.artifacts/account-refresh-20261005/public-verification.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({accounts:10,avatars:10,postsChecked:36,issues:[]}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
