// Focused recheck in an owned temporary database; never use the production database.
process.chdir('/app')
process.env.PORT='3199'
process.env.SKIP_MEDIA_PROBE='true'
const {prepareTestDatabase,dropTestDatabase}=require('/app/test/setupTestDatabase')
async function main() {
  let name,H,server,ok=false
  try {
    await prepareTestDatabase({onCreated:value=>{name=value}})
    H=require('/app/test/helpers')
    server=require('/app/server');await server.start()
    for(const file of ['17-home-feed','24-personal-feed','21-deployed-media']) await require('/app/test/'+file+'.suite')()
    ok=H.summary()
  } finally {
    try { if(H)await H.cleanup() }
    finally {
      try { if(server)await server.stop() }
      finally {
        try { if(H)await H.pool.end() }
        finally { if(name){await dropTestDatabase(name);console.log('OWNED_TEST_DATABASE_REMOVED='+name)} }
      }
    }
  }
  if(!ok)process.exitCode=1
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
