// Download openly licensed online avatar artwork and save self-hosted WebP assets.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const root = path.resolve(__dirname,'../..')
const sharp = require(path.join(root,'server/node_modules/sharp'))
sharp.concurrency(1)
const accounts = require('./accounts.json')
const directory = path.join(root,'assets/account-avatars-20261005')
const artifactDirectory = path.join(root,'.artifacts/account-refresh-20261005')
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
async function main() {
  fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(artifactDirectory,'sources'),{recursive:true})
  const users=[]
  for(const a of accounts) {
    const source=new URL(`https://api.dicebear.com/10.x/${a.style}/svg`)
    source.searchParams.set('seed',`SoulsGuide-${a.username}`);source.searchParams.set('size','256');source.searchParams.set('backgroundColor',a.background)
    const svgFile=path.join(artifactDirectory,'sources',`${a.username}.svg`)
    let original
    if(fs.existsSync(svgFile))original=fs.readFileSync(svgFile)
    else {
      const response=await fetch(source,{signal:AbortSignal.timeout(30000)})
      assert.equal(response.status,200,`avatar download failed: ${a.username}`)
      assert.ok(response.headers.get('content-type')?.includes('image/svg+xml'))
      original=Buffer.from(await response.arrayBuffer());assert.ok(original.length<100000)
      assert.ok(!/<script|<foreignObject|<!ENTITY|<image\b|href=["']https?:/i.test(original.toString('utf8')))
      fs.writeFileSync(svgFile,original)
    }
    const webp=await sharp(original).resize(256,256,{fit:'cover',kernel:'nearest'}).webp({quality:90,effort:5}).toBuffer()
    const file=`${a.username}.webp`;fs.writeFileSync(path.join(directory,file),webp)
    const info=await sharp(webp).metadata();assert.equal(info.width,256);assert.equal(info.height,256);assert.ok(webp.length<30*1024)
    users.push({...a,file,avatar:`/uploads/images/sg-account-avatars-20261005/${file}`,bytes:webp.length,sha256:sha(webp),source:source.href,sourcePage:`https://www.dicebear.com/styles/${a.style}/`,license:'CC0 1.0'})
  }
  assert.equal(new Set(users.map(u=>u.sha256)).size,10)
  const payload={batch:'account-refresh-20261005-v1',users}
  const bytes=Buffer.from(JSON.stringify(payload,null,2));fs.writeFileSync(path.join(__dirname,'payload.json'),bytes)
  fs.writeFileSync(path.join(artifactDirectory,'payload.sha256'),sha(bytes)+'\n')
  const tiles=[]
  for(let i=0;i<users.length;i++) {
    tiles.push({input:fs.readFileSync(path.join(directory,users[i].file)),left:(i%5)*256,top:Math.floor(i/5)*256})
  }
  await sharp({create:{width:1280,height:512,channels:3,background:'#eee6d9'}}).composite(tiles).png().toFile(path.join(artifactDirectory,'avatar-preview.png'))
  console.log(JSON.stringify({users:users.length,creators:7,ordinaryUsers:3,totalBytes:users.reduce((n,u)=>n+u.bytes,0),payloadSha256:sha(bytes),directory}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
