#!/usr/bin/env node
// Local production-bootstrap proof. The runtime adapter alone is a labeled,
// controlled meter fixture; usage and compaction events come from real prepare().
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../examples/browser-model-chat/serve.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'.artifacts/proof/context-indicator');
const prepared=resolve(root,'../rag-model-onboarding/.artifacts');
const coreSha256='c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6';
const graphSha256='90783080f8ce7849f5d0544864c7ac7bfb7875c689aecf1fa7951204b4112b3a';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],observations=[],screenshots=[],forbidden=[],errors=[],assets=[],fixtureCalls=[];
const cleanup={contextClosed:false,serverClosed:false,ownedProfileRemoved:false};
const started=Date.now(),harnessSha256=digest(await readFile(fileURLToPath(import.meta.url)));
let context,server,profile,page,session,base,error,browserVersion,sourceBefore,sourceAfter,workers=0,browserRequests=0;
const selectors={usage:'#context-usage',fill:'#context-fill',state:'#context-state',detail:'#context-detail',announcement:'#context-announcement',cue:'.memory-compaction-cue',halo:'.is-compaction-source'};
const adapter=`
const fixture=window.__contextFixture={label:'CONTROLLED CONTEXT UI FIXTURE — no model or native tokenizer',queue:[],calls:[],pending:[]};
const record=async value=>{fixture.calls.push(value);await window.__contextFixtureCall(value.kind);};
fixture.release=(error)=>{const waiting=fixture.pending.shift();if(!waiting)throw Error('No pending fixture meter.');error?waiting.reject(Error(error)):waiting.resolve(waiting.result);};
export function createRuntimeAdapter(){return{
 async prepare(){await record({kind:'prepare'});return{cached:false,modelId:'LABELED-CONTEXT-FIXTURE-NOT-MODEL',runtimeProfile:'memory64'};},
 async measure(messages,{signal}={}){
   const plan=fixture.queue.shift();if(!plan)throw Error('Unplanned extra meter call.');
   const result={promptTokens:plan.promptTokens,contextTokens:2048,overflow:plan.overflow??plan.promptTokens>2048,actualNativeTokenization:false,meter:'controlled-context-browser-fixture'};
   const serialized=JSON.stringify(messages),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
   await record({kind:'measure',requestSha256:[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join(''),messageCount:messages.length,result,signal:signal instanceof AbortSignal});
   if(plan.pause)return new Promise((resolve,reject)=>fixture.pending.push({resolve,reject,result}));
   if(plan.error)throw Error(plan.error);return result;
 },
 async reply(messages,options={}){await options.beforeDispatch?.();await options.onDispatch?.();await record({kind:'reply'});return'Generated context UI fixture reply, not a verified fact.';},
 async dispose(){await record({kind:'dispose'});}
};}`;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function settle(){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
async function check(name,run){try{await run();checks.push({name,status:'pass'});console.log('PASS context indicator: '+name);}catch(cause){checks.push({name,status:'fail',message:cause.message.slice(0,800)});throw cause;}}
async function sources(){
  const paths=[...new Set([['diff','--name-only','-z','HEAD'],['ls-files','--others','--exclude-standard','-z']].flatMap(args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}).split('\0').filter(Boolean)))].sort();
  return Promise.all(paths.map(async path=>{assert.ok(!path.startsWith('/')&&!path.split(/[\\/]/).includes('..'));const bytes=await readFile(join(root,path));return{path,bytes:bytes.length,sha256:digest(bytes)};}));
}
async function touch(type,points=[]){await session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((point,index)=>({...point,id:point.id??index+1,radiusX:3,radiusY:3,force:1}))});}
async function tap(selector){const r=await page.locator(selector).boundingBox();assert.ok(r,selector);await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await pause(30);await touch('touchEnd');await settle();}
async function loadFixture(){await page.waitForFunction(()=>window.localMemoryPreview?.workspace.context.usageSnapshot);await page.locator('#local-file').setInputFiles({name:'fixture-not-model.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('CONTEXT UI FIXTURE ONLY')});await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready');await settle();}
async function fresh(){await page.evaluate(()=>localStorage.clear());await page.goto(new URL('?memory=1',base).href);await loadFixture();await attachObservers();}
async function attachObservers(){await page.evaluate(()=>{const w=window.localMemoryPreview.workspace;window.__usageObserved=[w.context.usageSnapshot()];w.context.subscribeUsage(state=>window.__usageObserved.push(state));window.__preparedFixture=null;});}
async function snapshot(){return page.evaluate(selectors=>{
  const w=window.localMemoryPreview.workspace,usage=document.querySelector(selectors.usage),fill=document.querySelector(selectors.fill),cue=document.querySelector(selectors.cue);
  const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  return{usage:w.context.usageSnapshot(),view:{phase:usage.dataset.phase,measured:usage.dataset.measured,role:usage.getAttribute('role'),now:usage.getAttribute('aria-valuenow'),max:usage.getAttribute('aria-valuemax'),text:usage.getAttribute('aria-valuetext'),title:usage.title,caption:document.querySelector(selectors.state).textContent,detail:document.querySelector(selectors.detail).textContent,fillWidth:fill.style.width,rect:rect(usage)},
    activeElement:document.activeElement.id,compacted:w.events.list().filter(event=>event.type==='compacted'),context:w.context.snapshot(),
    fixture:{calls:window.__contextFixture.calls,pending:window.__contextFixture.pending.length},
    cue:cue?{hidden:cue.hidden,text:cue.textContent,eventId:cue.dataset.eventId,halo:[...document.querySelectorAll(selectors.halo)].map(node=>({id:node.dataset.memoryNode,scope:node.dataset.memoryScope,kind:node.dataset.memoryKind,animation:getComputedStyle(node,'::after').animationName}))}:null,
    viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale,documentWidth:document.documentElement.scrollWidth,scrollX,scrollY}};
},selectors);}
const meterCalls=state=>state.fixture.calls.filter(call=>call.kind==='measure');
function assertUsage(state,phase,count){assert.equal(state.usage.phase,phase);assert.equal(state.view.phase,phase);if(count===null){assert.equal(state.usage.measurement,null);assert.equal(state.view.now,null);assert.equal(state.view.measured,'false');}else{assert.equal(state.usage.measurement.promptTokens,count);assert.equal(state.usage.measurement.quality,'fixture');assert.equal(Number(state.view.now),Math.min(count,1888));assert.equal(Number(state.view.max),1888);assert.match(state.view.text,/fixture/i);assert.equal(state.view.role,'meter');}assert.equal(state.usage.capacity,2048);assert.equal(state.usage.reserve,160);assert.equal(state.usage.usablePromptTokens,1888);}
async function seedHistory(label='first'){
  return page.evaluate(label=>{const w=window.localMemoryPreview.workspace,originals=[];for(const[key,value]of[['city','Bristol'],['delivery','Thursday'],['format','one sentence']]){
    originals.push(w.conversation.append({role:'user',content:('Original '+label+' source prose remains in the transcript. ').repeat(45)+'\nFact['+key+']: '+value+'.'}));
    w.conversation.append({role:'assistant',content:'Generated fixture answer is not source authority. '+label});
  }return originals.map(turn=>turn.id);},label);
}
async function beginPrepare(plans,{appendQuestion=true,signal=false}={}){
  await page.evaluate(({plans,appendQuestion,signal})=>{const w=window.localMemoryPreview.workspace;window.__contextFixture.queue.push(...plans);if(appendQuestion)w.conversation.append({role:'user',content:'What are the city, delivery and reply format?'});window.__prepareAbort=signal?new AbortController():null;const pending=window.__preparedFixture={settled:false};w.prepare(signal?{signal:window.__prepareAbort.signal}:undefined).then(result=>{pending.result=result;pending.settled=true;},cause=>{pending.error={name:cause.name,message:cause.message};pending.settled=true;});},{plans,appendQuestion,signal});
}
async function waitPrepared(){await page.waitForFunction(()=>window.__preparedFixture?.settled);await settle();return page.evaluate(()=>({error:window.__preparedFixture.error,result:window.__preparedFixture.result}));}
async function compaction(label){await seedHistory(label);await beginPrepare([{promptTokens:2300},{promptTokens:640}]);const prepared=await waitPrepared();assert.equal(prepared.error,undefined);assert.ok(prepared.result.compaction);await page.evaluate(()=>window.localMemoryPreview.workspace.persist());return(await snapshot()).compacted.at(-1);}
async function openMemory(){await tap('#memory-open');await page.waitForFunction(()=>document.getElementById('memory-graph').dataset.renderer==='tsl');await settle();}
async function closeMemory(){await tap('#memory-close');await settle();}
async function screenshot(name){const path=join(output,name);await page.screenshot({path});const bytes=await readFile(path);screenshots.push({path:'.artifacts/proof/context-indicator/'+name,sha256:digest(bytes),bytes:bytes.length,labeledFixture:true});}
async function emptyPoint(){return page.evaluate(()=>{const surface=document.getElementById('memory-graph'),canvas=surface.querySelector('canvas'),r=surface.getBoundingClientRect();for(const fy of[.3,.5,.7])for(const fx of[.25,.4,.6,.75]){const p={x:r.x+r.width*fx,y:r.y+r.height*fy};if([p,{x:p.x+30,y:p.y+20}].every(q=>q.x<r.right-5&&q.y<r.bottom-5&&[surface,canvas].includes(document.elementFromPoint(q.x,q.y))))return p;}throw Error('No empty graph contact path');});}

try{
  const driver=process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE,chrome=process.env.MODEL_CHAT_BROWSER;assert.ok(driver&&chrome,'Explicit prepared Playwright/Chrome required.');await Promise.all([access(driver),access(chrome)]);
  sourceBefore=await sources();assert.equal(digest(await readFile(join(prepared,'memory/rag-core.mjs'))),coreSha256);assert.equal(digest(await readFile(join(prepared,'memory/graph-renderer.mjs'))),graphSha256);await mkdir(output,{recursive:true});
  server=await startServer({runtimeRoot:join(prepared,'model-chat/runtime'),memoryCoreRoot:join(prepared,'memory'),memoryGraphRoot:join(prepared,'memory')});base=new URL(server.url);
  const{chromium}=await import(pathToFileURL(resolve(driver)).href);profile=await mkdtemp(join(tmpdir(),'rag-context-indicator-'));context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,chromiumSandbox:true,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:1,viewport:{width:390,height:844},reducedMotion:'no-preference',ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings']});browserVersion=context.browser()?.version();
  await context.exposeBinding('__contextFixtureCall',(_source,kind)=>{if(kind==='worker-attempt')workers++;else fixtureCalls.push(kind);});
  await context.addInitScript(()=>{window.Worker=class{constructor(){void window.__contextFixtureCall('worker-attempt');throw Error('Worker forbidden in context UI fixture.');}};const observer=new MutationObserver(()=>{for(const header of[document.querySelector('.masthead'),document.querySelector('#memory-dialog .memory-panel-header')])if(header&&!header.querySelector('.context-fixture-label')){const label=document.createElement('small');label.className='context-fixture-label';label.textContent='CONTEXT UI FIXTURE — no model/native tokenizer';label.style.cssText='position:absolute;bottom:0;left:12px;font:8px/10px ui-monospace;color:#ffedc8;pointer-events:none;z-index:3';header.style.position='relative';header.append(label);}});observer.observe(document,{childList:true,subtree:true});});
  await context.route('**/*',async route=>{
    assert.ok(++browserRequests<=400,'Finite400 browser-request budget');const url=new URL(route.request().url()),path=url.pathname.slice(1)||'index.html';
    if(url.origin!==base.origin||/\/runtime\/|\.wasm$|engine-worker\.mjs|\.gguf$/i.test(url.pathname)||route.request().resourceType()==='worker'){forbidden.push(url.pathname);return route.abort();}
    if(path==='runtime-adapter.mjs')return route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:adapter});
    try{const response=await route.fetch();assert.equal(response.status(),200,path);const bytes=await response.body();if(/\.(?:mjs|js)$/.test(path))assert.match(response.headers()['content-type']||'',/^(?:text|application)\/javascript(?:;|$)/i,path+' executable MIME');
      const source=path==='memory/rag-core.mjs'?join(prepared,'memory/rag-core.mjs'):path==='memory/graph-renderer.mjs'?join(prepared,'memory/graph-renderer.mjs'):path.startsWith('theme/')?join(root,'modules/browser-rag-ts/demo',path.slice(6)):join(root,'examples/browser-model-chat',path);
      assert.equal(digest(bytes),digest(await readFile(source)),'Actual production bytes '+path);assets.push({path,sha256:digest(bytes),bytes:bytes.length});return route.fulfill({response});
    }catch(cause){errors.push(cause.message);return route.abort();}
  });
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',cause=>errors.push(cause.message));page.on('worker',()=>workers++);session=await context.newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.goto(new URL('?memory=1',base).href);await loadFixture();await attachObservers();

  await check('empty workspace remains honestly unmeasured without a meter call',async()=>{const state=await snapshot();assertUsage(state,'unmeasured',null);assert.equal(meterCalls(state).length,0);assert.match(state.view.caption,/not measured/i);observations.push({case:'empty',state});});
  await check('near-budget preparation uses one fixture measurement and no view-induced measurement',async()=>{await beginPrepare([{promptTokens:1880,overflow:false}]);await waitPrepared();const state=await snapshot();assertUsage(state,'ready',1880);assert.equal(meterCalls(state).length,1);assert.equal(state.compacted.length,0);assert.ok(parseFloat(state.view.fillWidth)>99&&parseFloat(state.view.fillWidth)<=100);await page.locator('#prompt').focus();await page.locator('#prompt').fill('A draft remains editable.');await settle();assert.equal((await snapshot()).activeElement,'prompt');assert.equal(meterCalls(await snapshot()).length,1);observations.push({case:'near-budget',state});});
  await check('real compaction keeps its high count until the final prepared request is accepted',async()=>{
    await fresh();await seedHistory('successful');const transcriptBefore=await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState());await beginPrepare([{promptTokens:2300},{promptTokens:640,pause:true}]);await page.waitForFunction(()=>window.__contextFixture.pending.length===1);await settle();
    const during=await snapshot();assertUsage(during,'compacting',2300);assert.equal(during.compacted.length,0);assert.equal(meterCalls(during).length,2);assert.equal(during.context.cycle,0);assert.match(during.view.caption,/compacting/i);observations.push({case:'compacting-before-second-meter-result',state:during});
    await page.evaluate(()=>window.__contextFixture.release());const result=await waitPrepared(),after=await snapshot();assert.equal(result.error,undefined);assertUsage(after,'ready',640);assert.equal(after.compacted.length,1);assert.equal(after.context.cycle,1);assert.equal(meterCalls(after).length,2);assert.equal(after.compacted[0].beforePromptTokens,2300);assert.equal(after.compacted[0].afterPromptTokens,640);assert.equal(after.compacted[0].requestAfterSha256,after.usage.measurement.requestSha256);assert.ok(after.compacted[0].sourceTurnIds.length>0);
    const transcriptAfter=await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState());assert.deepEqual(JSON.parse(transcriptAfter).turns.slice(0,JSON.parse(transcriptBefore).turns.length),JSON.parse(transcriptBefore).turns,'Every original canonical turn remains byte-exact');observations.push({case:'successful-final-prepare',state:after});
  });
  await check('a new successful compaction cues only its actual source nodes once on Memory open',async()=>{
    const before=await snapshot(),event=before.compacted.at(-1);await openMemory();await page.waitForFunction(()=>!document.querySelector('.memory-compaction-cue').hidden);const shown=await snapshot();assert.equal(shown.cue.eventId,event.id);assert.match(shown.cue.text,/Context compacted.*originals kept/i);assert.ok(shown.cue.halo.length>0);for(const node of shown.cue.halo){assert.equal(node.scope,'conversation');assert.equal(node.kind,'message');assert.ok(event.sourceTurnIds.some(id=>node.id==='turn:'+id));}assert.equal(meterCalls(shown).length,meterCalls(before).length);await pause(800);await screenshot('memory-compaction-source-cue.png');observations.push({case:'new-source-cue',event,shown:shown.cue});await closeMemory();await openMemory();const reopened=await snapshot();assert.equal(reopened.cue.hidden,true);assert.deepEqual(reopened.cue.halo,[]);await closeMemory();
  });
  await check('failed and cancelled second measurements never reduce the bar or append a compaction event',async()=>{
    for(const cancel of[false,true]){await fresh();await seedHistory(cancel?'cancelled':'failed');await beginPrepare([{promptTokens:2300},{promptTokens:640,pause:true}],{signal:cancel});await page.waitForFunction(()=>window.__contextFixture.pending.length===1);const before=await snapshot();assertUsage(before,'compacting',2300);if(cancel)await page.evaluate(()=>window.__prepareAbort.abort());else await page.evaluate(()=>window.__contextFixture.release('Controlled second-meter failure.'));await waitPrepared();const failed=await snapshot();assertUsage(failed,cancel?'cancelled':'error',2300);assert.equal(failed.compacted.length,0);assert.equal(failed.context.cycle,0);assert.equal(failed.usage.compaction,null);if(cancel){await page.evaluate(()=>window.__contextFixture.release());await pause(40);assertUsage(await snapshot(),'cancelled',2300);}observations.push({case:cancel?'cancelled':'failed',state:failed});}
  });
  await check('actual composer Stop cancels a pending compaction without a reply or false reduction',async()=>{
    await fresh();await seedHistory('composer-stop');await page.evaluate(()=>window.__contextFixture.queue.push({promptTokens:2300},{promptTokens:640,pause:true}));await page.locator('#prompt').fill('What are the city, delivery and reply format?');await tap('#send');await page.waitForFunction(()=>window.__contextFixture.pending.length===1);await settle();assert.equal(await page.locator('#stop').isVisible(),true);assert.equal(await page.locator('#send').isDisabled(),true);assertUsage(await snapshot(),'compacting',2300);await screenshot('context-compacting-composer.png');await tap('#stop');await page.waitForFunction(()=>!document.querySelector('.message.pending'));await settle();const stopped=await snapshot();assert.equal(stopped.usage.measurement.promptTokens,2300);assert.ok(['cancelled','stale'].includes(stopped.usage.phase));assert.equal(stopped.compacted.length,0);assert.equal(stopped.fixture.calls.filter(call=>call.kind==='reply').length,0);await page.evaluate(()=>window.__contextFixture.release());await pause(40);assert.equal((await snapshot()).usage.measurement.promptTokens,2300);observations.push({case:'composer-stop',state:stopped});
  });
  await check('gesture interruption consumes a new cue and reduced motion uses text only',async()=>{
    await fresh();const event=await compaction('gesture');await openMemory();await page.waitForFunction(()=>!document.querySelector('.memory-compaction-cue').hidden);const point=await emptyPoint();await touch('touchStart',[point]);await touch('touchMove',[{x:point.x+30,y:point.y+20}]);await touch('touchEnd');await settle();let state=await snapshot();assert.equal(state.cue.hidden,true);assert.deepEqual(state.cue.halo,[]);await closeMemory();await openMemory();assert.equal((await snapshot()).cue.hidden,true);await closeMemory();await page.emulateMedia({reducedMotion:'reduce'});const reducedEvent=await compaction('reduced-motion');assert.notEqual(reducedEvent.id,event.id);await openMemory();await page.waitForFunction(()=>!document.querySelector('.memory-compaction-cue').hidden);state=await snapshot();assert.equal(state.cue.eventId,reducedEvent.id);assert.deepEqual(state.cue.halo,[]);observations.push({case:'gesture-and-reduced-motion',eventId:reducedEvent.id,cue:state.cue});await closeMemory();
  });
  await check('reload drops stale token claims and consumes retained old compaction events silently',async()=>{
    await page.evaluate(()=>window.localMemoryPreview.workspace.persist());await page.reload();await loadFixture();await attachObservers();const state=await snapshot();assertUsage(state,'unmeasured',null);assert.ok(state.compacted.length>0);assert.equal(meterCalls(state).length,0);await openMemory();assert.equal((await snapshot()).cue.hidden,true);assert.deepEqual((await snapshot()).cue.halo,[]);await closeMemory();observations.push({case:'reloaded-old-events',state});
  });
  await check('320px 390px and short landscape keep the slim bar and composer accessible without extra measurement',async()=>{
    await fresh();await beginPrepare([{promptTokens:900}]);await waitPrepared();await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.append({role:'assistant',content:'Canonical fixture transcript changed after preparation.'}));assertUsage(await snapshot(),'stale',900);
    for(const viewport of[{width:320,height:568},{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);await settle();await page.locator('#prompt').focus();await page.locator('#prompt').fill('Native composer edit remains available.');await settle();const state=await snapshot(),prompt=await page.locator('#prompt').boundingBox(),send=await page.locator('#send').boundingBox();assert.ok(state.view.rect.height<=40,'slim context row');assert.ok(state.view.rect.y+state.view.rect.height<=prompt.y+1);assert.ok(prompt.y>=0&&prompt.y+prompt.height<=viewport.height+1);assert.ok(send.x>=0&&send.x+send.width<=viewport.width+1);assert.ok(state.viewport.documentWidth<=viewport.width+1);assert.equal(state.viewport.scrollX,0);assert.equal(state.activeElement,'prompt');assert.equal(meterCalls(state).length,1);observations.push({case:'layout',viewport,bar:state.view.rect,prompt,send});}
    await page.setViewportSize({width:390,height:844});await page.goto(new URL('?memory=0',base).href);await page.waitForFunction(()=>document.getElementById('context-usage'));await page.locator('#local-file').setInputFiles({name:'fixture-not-model.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('BASIC CONTEXT UI FIXTURE ONLY')});await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready');assert.equal(await page.locator('#context-usage').isVisible(),false);assert.equal(await page.evaluate(()=>window.__contextFixture.calls.filter(call=>call.kind==='measure').length),0);
  });
  await check('production bytes original transcript and finite no-model boundaries remain intact',async()=>{assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);assert.equal(workers,0);assert.equal(screenshots.length,2);sourceAfter=await sources();assert.deepEqual(sourceAfter,sourceBefore,'Every dirty candidate byte stays frozen through browser proof');});
}catch(cause){error=cause.stack||cause.message;process.exitCode=1;console.error(error);}
finally{
  const fail=cause=>{error=error||cause.message;process.exitCode=1;};if(context)await context.close().then(()=>{cleanup.contextClosed=true;},fail);if(server)await server.close().then(()=>{cleanup.serverClosed=true;},fail);if(profile&&dirname(profile)===resolve(tmpdir())&&basename(profile).startsWith('rag-context-indicator-'))await rm(profile,{recursive:true,force:true}).then(()=>{cleanup.ownedProfileRemoved=true;},fail);
  const compact=observations.map(value=>{if(!value.state)return value;const{fixture,...state}=value.state;return{...value,state:{...state,fixture:{pending:fixture.pending,callCounts:Object.fromEntries(['prepare','measure','reply','dispose'].map(kind=>[kind,fixture.calls.filter(call=>call.kind===kind).length])),callsSha256:digest(JSON.stringify(fixture.calls))}}};});
  const receipt={schema:'context-indicator-browser/v1',status:error?'fail':'pass',durationMs:Date.now()-started,browserVersion,harnessSha256,sourceBefore,sourceAfter,checks,observations:compact,screenshots,error,fixtureCalls:Object.fromEntries(['prepare','measure','reply','dispose'].map(kind=>[kind,fixtureCalls.filter(value=>value===kind).length])),assets:{verifiedResponses:assets.length,uniquePaths:new Set(assets.map(asset=>asset.path)).size,identitySha256:digest(JSON.stringify(assets)),browserRequests},boundary:{localOnly:true,productionBootstrap:true,adapterOnlyControlledFixture:true,realStores:true,realContextPrepare:true,realCompactionEvents:true,realCore:true,realTSL:true,nativeTokenization:false,modelCalls:0,modelDownloads:0,runtimeWasmFetched:false,workers,unexpectedRequests:forbidden.length,physicalDevice:false,iosQualified:false},cleanup,limitations:['Fixture meter values exercise preparation boundaries; native tokenizer/model and physical mobile behavior are not qualified.']};
  const bytes=JSON.stringify(receipt)+'\n';assert.ok(Buffer.byteLength(bytes)<=48*1024,'Single browser phase receipt48KiB bound');await mkdir(output,{recursive:true});await writeFile(join(output,'receipt.json'),bytes);
}
