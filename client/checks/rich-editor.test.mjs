/* global URL, File, console */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { setImmediate } from 'node:timers/promises'
const script=readFileSync(new URL('../src/components/RichTextEditor.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm,'')
const events=[],cleanup=[],uploads=[]
const ctx={ watch(){},onBeforeUnmount:f=>cleanup.push(f),defineProps:()=>({}),defineModel:()=>({value:''}),defineEmits:()=>((...args)=>events.push(args)),
  useTheme:()=>({isDark:{value:true}}),File,compressImage:async(file,options)=>{assert.equal(options.maxWidth,1920);return file},
  mediaApi:{uploadImage:file=>new Promise((resolve,reject)=>uploads.push({file,resolve,reject}))},editorContentCss:'',documentContentCss:'' }
vm.createContext(ctx)
vm.runInContext(ts.transpileModule(script+'\nglobalThis.check={editorInit};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,ctx)
const options=ctx.check.editorInit
assert.equal(options.mobile.toolbar_mode,'scrolling');assert.ok(options.mobile.toolbar.includes('image'));assert.equal(options.image_uploadtab,true)
const blobInfo={blob:()=>new File(['fixture'],'image.png',{type:'image/png'}),filename:()=> 'image.png'}
const a=options.images_upload_handler(blobInfo),b=options.images_upload_handler(blobInfo)
await setImmediate()
assert.equal(uploads.length,2);assert.deepEqual(events[0],['busy',true]);assert.deepEqual(events[1],['busy',true])
uploads[0].resolve({data:{url:'/uploads/a.webp'}});assert.equal(await a,'/uploads/a.webp');assert.deepEqual(events.at(-1),['busy',true])
uploads[1].reject(Error('network'));await assert.rejects(b);assert.deepEqual(events.at(-1),['busy',false])
const c=options.images_upload_handler(blobInfo);await setImmediate()
cleanup.forEach(f=>f());const count=events.length
assert.deepEqual(events.at(-1),['ready',false]);uploads[2].resolve({data:{url:'/uploads/c.webp'}});await c;assert.equal(events.length,count)
console.log('PASS: touch toolbar, two-image busy lifetime, failed upload unlocks, no stale events after unmount')
