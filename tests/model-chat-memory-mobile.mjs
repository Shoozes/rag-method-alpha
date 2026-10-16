#!/usr/bin/env node
// Local or explicitly pinned HTTPS touch diagnosis: production bootstrap/stores/core/TSL; only the runtime
// adapter is a visibly labeled fixture. CDP touch contacts, no model/runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';
import { NODE_COLOR_THRESHOLDS, measureNodeColorArea, assessNodeColorArea } from './node-color-area.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),live=process.argv.includes('--live');
const liveProofRoot=resolve(root,'../rag-mobile-memory/.artifacts/proof/memory-mobile');
if(live&&resolve(process.env.BROWSER_MEMORY_PROOF_ROOT||'')!==liveProofRoot)throw Error('Live proof requires the explicit existing mobile proof root.');
const output=live?liveProofRoot:join(root,'.artifacts/proof/memory-mobile');
const phase=live||process.argv.includes('--after')?'after':'before',profilePrefix='rag-memory-mobile-';
const palette={conversation:'#0ea5ff',persona:'#c81fff',global:'#f59e0b'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const harnessSha256=digest(await readFile(fileURLToPath(import.meta.url)));
const checks=[],observations=[],screenshots=[],forbidden=[],pageErrors=[],fixtureCalls=[];
const servedAssets=[];
const assetFailures=[],network={requests:0,bytes:0};
const limitations=['Trusted mouse detail selection is tested in an emulated touch viewport; physical touch selection and iOS are unqualified.'];
const cleanup={contextClosed:false,serverClosed:false,ownedProfileRemoved:false};
const sourcePaths=['bootstrap.mjs','app.mjs','style.css','memory/panel.mjs','memory/panel.css','memory/automatic-memory.mjs'];
let context,server,profile,session,page,error,browserVersion,sourceIdentity,graphIdentity,coreIdentity,prior,lastGesture,base,manifest,preflight,workers=0;
const started=Date.now();
const longText='My notebooks use copper covers. These are exact user words from this labeled touch fixture. '
  +'The long source lets us inspect native detail scrolling without fabricated history. '.repeat(16).trimEnd();
const adapter=`
export function createRuntimeAdapter(){return{
 async prepare(){await window.__mobileFixtureCall('prepare');return{cached:false,modelId:'LABELED-TOUCH-FIXTURE-NOT-MODEL',runtimeProfile:'memory64'};},
 async measure(messages){await window.__mobileFixtureCall('measure');const promptTokens=16+messages.reduce((sum,item)=>sum+Math.ceil(item.content.length/4)+8,0);return{promptTokens,contextTokens:2048,overflow:promptTokens>2048};},
 async reply(messages,options={}){await options.beforeDispatch?.();await options.onDispatch?.();await window.__mobileFixtureCall('reply');return'Generated fixture reply, not a verified fact.';},async dispose(){}
};}`;
function required(name,pattern){const value=process.env[name]?.trim();assert.ok(value&&(!pattern||pattern.test(value)),'Set '+name+' explicitly to the reviewed value.');return value;}
function executableMime(type){return /^(?:application|text)\/javascript(?:;|$)/i.test(type||'');}
async function liveAsset(path,limit){
  assert.ok(++network.requests<=160,'Finite160-request live proof budget');
  const target=new URL(path,base);assert.equal(target.origin,base.origin);assert.ok(target.pathname.startsWith(base.pathname));
  const response=await fetch(target,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});assert.equal(response.url,target.href);
  const chunks=[];let count=0;
  if(response.body){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;network.bytes+=part.value.byteLength;
    if(count>limit||network.bytes>16*1024*1024){await reader.cancel();throw Error('Finite live asset byte budget exceeded.');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}}
  const bytes=Buffer.concat(chunks);assert.equal(response.status,200,path);return{response,bytes};
}
async function verifiedLiveAsset(path){
  const expected=manifest.files.find(file=>file.path===path);assert.ok(expected,'Manifest admits '+path);
  const result=await liveAsset(path,expected.bytes);assert.equal(result.bytes.length,expected.bytes,path);assert.equal(digest(result.bytes),expected.sha256,path);
  const type=result.response.headers.get('content-type')||'';
  if(/\.(?:mjs|js)$/.test(path))assert.ok(executableMime(type),path+' executable MIME');
  else if(path.endsWith('.css'))assert.match(type,/^text\/css(?:;|$)/i,path+' CSS MIME');
  else if(path.endsWith('.html'))assert.match(type,/^text\/html(?:;|$)/i,path+' HTML MIME');
  return result;
}
async function livePreflight(){
  base=new URL(required('BROWSER_MEMORY_PREVIEW_URL'));assert.equal(base.href,'https://shoozes.github.io/rag-method-alpha/model-chat/');
  const expectedManifest=required('BROWSER_MEMORY_EXPECTED_MANIFEST_SHA256',/^[a-f0-9]{64}$/),head=required('BROWSER_MEMORY_EXPECTED_SOURCE_HEAD',/^[a-f0-9]{40}$/),fingerprint=required('BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT',/^[a-f0-9]{64}$/);
  const {response,bytes}=await liveAsset('site-manifest.json',128*1024);assert.match(response.headers.get('content-type')||'',/^application\/json(?:;|$)/i);assert.equal(digest(bytes),expectedManifest);manifest=JSON.parse(bytes);
  const {identitySha256,...body}=manifest;assert.equal(identitySha256,digest(JSON.stringify(body)));assert.equal(manifest.schema,'rag-model-chat-static/v1');assert.equal(manifest.memoryPreview,true);assert.equal(manifest.publicReleaseQualified,false);assert.equal(manifest.model.weightsIncluded,false);
  assert.equal(manifest.source.head,head);assert.equal(manifest.source.dirty,false);assert.equal(manifest.source.fingerprintSha256,fingerprint);assert.equal(digest(JSON.stringify(manifest.source.files)),fingerprint);assert.equal(manifest.files.length,42);
  assert.equal(new Set(manifest.files.map(file=>file.path)).size,42);for(const file of manifest.files){assert.match(file.path,/^[A-Za-z0-9_./-]+$/);assert.ok(!file.path.startsWith('/')&&!file.path.split('/').includes('..'));assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0);}
  coreIdentity={sha256:'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6'};graphIdentity={sha256:required('BROWSER_MEMORY_EXPECTED_GRAPH_SHA256',/^[a-f0-9]{64}$/)};
  assert.equal(manifest.files.find(file=>file.path==='memory/rag-core.mjs')?.sha256,coreIdentity.sha256);assert.equal(manifest.files.find(file=>file.path==='memory/graph-renderer.mjs')?.sha256,graphIdentity.sha256);
  sourceIdentity=sourcePaths.map(path=>({path,sha256:manifest.files.find(file=>file.path===path)?.sha256}));
  for(const path of [...sourcePaths,'index.html','runtime-adapter.mjs','memory/rag-core.mjs','memory/graph-renderer.mjs'])await verifiedLiveAsset(path);
  preflight={sourceHead:head,manifestSha256:expectedManifest,sourceFingerprint:fingerprint,manifestIdentity:identitySha256,criticalAssets:sourcePaths.length+4,productionBootstrapAndOriginalAdapterVerified:true};
}
async function check(name,run){const at=Date.now();try{await run();checks.push({name,status:'pass',durationMs:Date.now()-at});console.log('PASS mobile memory: '+name);}catch(cause){checks.push({name,status:'fail',durationMs:Date.now()-at,message:cause.message});throw cause;}}
const pause=ms=>new Promise(accept=>setTimeout(accept,ms));
async function settle(){await page.evaluate(()=>new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept))));}
async function touch(type,points=[]){await session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((point,index)=>({x:point.x,y:point.y,id:point.id??index+1,radiusX:3,radiusY:3,force:1}))});}
async function tap(selector){const rect=await page.locator(selector).boundingBox();assert.ok(rect,selector+' visible');await touch('touchStart',[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]);await pause(35);await touch('touchEnd');await settle();}
async function swipe(from,to,{cancel=false,hold=0}={}){await touch('touchStart',[from]);if(hold)await pause(hold);for(let step=1;step<=6;step++){await touch('touchMove',[{x:from.x+(to.x-from.x)*step/6,y:from.y+(to.y-from.y)*step/6}]);await pause(20);}await touch(cancel?'touchCancel':'touchEnd');await pause(80);await settle();}
async function snapshot(){return page.evaluate(()=>{
  const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  const canvas=document.querySelector('#memory-graph canvas'),detail=document.getElementById('memory-detail');
  return{viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale,offsetX:visualViewport?.offsetLeft,offsetY:visualViewport?.offsetTop},page:{x:scrollX,y:scrollY,documentWidth:document.documentElement.scrollWidth},
    graph:{...rect(canvas),touchAction:getComputedStyle(document.getElementById('memory-graph')).touchAction,userSelect:getComputedStyle(document.getElementById('memory-graph')).userSelect},canvas:{touchAction:getComputedStyle(canvas).touchAction,userSelect:getComputedStyle(canvas).userSelect,draggable:canvas.draggable,renderer:document.getElementById('memory-graph').dataset.renderer,backend:document.getElementById('memory-graph').dataset.backend},
    cameraPose:canvas.dataset.cameraPose?JSON.parse(canvas.dataset.cameraPose):null,nodeColors:canvas.dataset.nodeColors?JSON.parse(canvas.dataset.nodeColors):null,
    nodes:[...document.querySelectorAll('[data-memory-node]')].map(node=>{const r=rect(node);return{id:node.dataset.memoryNode,scope:node.dataset.memoryScope,...r,visible:!node.hidden&&Boolean(node.getClientRects().length),centerOwner:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-memory-node]')?.dataset.memoryNode||null,matched:node.dataset.matched,selected:node.getAttribute('aria-pressed')};}),
    detail:{visible:!detail.hidden,scrollTop:detail.scrollTop,scrollHeight:detail.scrollHeight,clientHeight:detail.clientHeight},dialogScroll:document.getElementById('memory-dialog').scrollTop,bodyScroll:document.querySelector('.memory-panel-body').scrollTop,
    selection:getSelection()?.toString().slice(0,120),images:[...document.images].map(image=>({draggable:image.draggable,dragAttribute:image.getAttribute('draggable')})),
    eventLog:window.__mobileEvents.splice(0),cameraFrames:window.__mobileCameraFrames};
  });}
function movement(before,after){const map=new Map(before.nodes.filter(node=>node.visible!==false).map(node=>[node.id,node]));const moves=after.nodes.filter(node=>node.visible!==false&&map.has(node.id)).map(node=>{const old=map.get(node.id);return{id:node.id,dx:node.x-old.x,dy:node.y-old.y};});return{maximumPixels:Math.max(0,...moves.map(node=>Math.hypot(node.dx,node.dy))),moves,viewportScaleBefore:before.viewport.scale,viewportScaleAfter:after.viewport.scale,cameraFrames:after.cameraFrames-before.cameraFrames};}
function boundedRows(rows,edge=1){return{rowCount:rows.length,sha256:digest(JSON.stringify(rows)),first:rows.slice(0,edge),last:rows.length>edge?rows.slice(-edge):[]};}
function compactSnapshot(state,light=false){
  const {nodes,eventLog,selection,nodeColors,...rest}=state,counts={};for(const event of eventLog)counts[event.type]=(counts[event.type]||0)+1;
  const result={...rest,nodeColors:nodeColors?{rowCount:nodeColors.length,sha256:digest(JSON.stringify(nodeColors))}:null,nodeProjection:boundedRows(nodes),selectedNodeIds:nodes.filter(node=>node.selected==='true').map(node=>node.id),
    events:{...boundedRows(eventLog,2),counts,cancels:eventLog.filter(event=>event.type==='pointercancel'||event.type==='touchcancel').slice(0,4)},
    selection:selection?{length:selection.length,sha256:digest(selection),sample:selection.slice(0,80)}:{length:0}};
  if(light){delete result.nodeProjection.first;delete result.nodeProjection.last;delete result.events.first;delete result.events.last;delete result.events.cancels;}return result;
}
function compactObservation(value){
  if(value.gesture)return{gesture:value.gesture,before:compactSnapshot(value.before,true),after:compactSnapshot(value.after),movement:{...value.movement,moves:boundedRows(value.movement.moves)}};
  if(value.state?.nodes)return{...value,state:compactSnapshot(value.state)};return value;
}
async function blankPoint(pinch=false){return page.evaluate(pinch=>{const surface=document.getElementById('memory-graph'),canvas=surface.querySelector('canvas'),r=canvas.getBoundingClientRect();for(const fraction of pinch?[.45,.5,.4,.55,.35,.6,.3,.2]:[.12,.2,.3,.4,.5,.7,.8])for(const x of pinch?[.5,.4,.6,.3,.7]:[.2,.4,.6,.8]){const point={x:r.x+r.width*x,y:r.y+r.height*fraction};const contacts=pinch?[-55,-25,25,55].map(dx=>({x:point.x+dx,y:point.y})):[point,{x:point.x+45,y:point.y+35}];if(contacts.every(point=>point.x>r.x+2&&point.x<r.right-2&&point.y>r.y+2&&point.y<r.bottom-2&&[canvas,surface].includes(document.elementFromPoint(point.x,point.y))))return point;}throw Error('No empty graph touch path found.');},pinch);}
async function back(){if(await page.locator('#memory-back').isVisible())await tap('#memory-back');await settle();}
async function recordGesture(name,run){const before=await snapshot();await run(before);const after=await snapshot();lastGesture={gesture:name,before,after,movement:movement(before,after)};observations.push(compactObservation(lastGesture));return{before,after};}
async function resetGraph(){await tap('#memory-close');await tap('#memory-open');await page.waitForFunction(()=>document.getElementById('memory-graph').dataset.renderer==='tsl');await settle();}
async function fitGraph(){await tap('#memory-fit');await settle();assert.equal(await page.locator('[data-memory-node]:visible').count(),8,'Fit recovers all actual nodes');}
async function nativeZoomControl(){const control=await context.newPage();try{await control.route('**/native-zoom-control',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><p>LABELED NATIVE ZOOM CONTROL</p><div style="height:2500px">Plain native page without app CSS or scripts</div>'}));await control.goto(new URL('native-zoom-control',base).href);const cdp=await context.newCDPSession(control);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5,configuration:'mobile'});const before=await control.evaluate(()=>visualViewport.scale);await cdp.send('Input.synthesizePinchGesture',{x:195,y:350,scaleFactor:1.3,relativeSpeed:400,gestureSourceType:'touch'});await pause(120);return{fixture:true,before,after:await control.evaluate(()=>visualViewport.scale),noAppCss:true};}finally{await control.close();}}
async function liftNode(id){const rect=await page.locator('[data-memory-node="'+id+'"]').boundingBox();const bounds=await page.locator('#memory-graph').boundingBox(),dy=Math.min(0,bounds.y+bounds.height*.25-(rect.y+22));if(dy>-20)return;
  const start=await page.evaluate(dy=>{const surface=document.getElementById('memory-graph'),r=surface.getBoundingClientRect();for(const fraction of [.8,.7,.6,.5])for(const x of [.2,.4,.6,.8]){const point={x:r.x+r.width*x,y:r.y+r.height*fraction};if(point.y+dy>r.y+4&&[point,{x:point.x,y:point.y+dy}].every(value=>document.elementFromPoint(value.x,value.y)===surface))return point;}throw Error('No empty graph path for selected-node presentation.');},dy);await swipe(start,{x:start.x,y:start.y+dy});}
function stablePage(before,after){assert.equal(after.viewport.scale,before.viewport.scale,'gesture changes graph, not page zoom');assert.equal(after.page.y,before.page.y);assert.equal(after.page.x,before.page.x);assert.ok(Math.abs(after.graph.width-before.graph.width)<1&&Math.abs(after.graph.height-before.graph.height)<1,'graph viewport stable');}
function assertPan(before,after){stablePage(before,after);assert.ok(movement(before,after).maximumPixels>8,'actual projected nodes move during intentional pan');assert.notDeepEqual(after.cameraPose,before.cameraPose,'actual native camera pose moves');assert.ok(!after.eventLog.some(event=>event.type==='pointercancel'),'browser did not steal graph pan');assert.equal(after.selection,'');assert.equal(after.eventLog.filter(event=>event.type==='dragstart').length,0);}
function pairScale(before,after){const previous=new Map(before.nodes.filter(node=>node.visible!==false).map(node=>[node.id,node]));const common=after.nodes.filter(node=>node.visible!==false&&previous.has(node.id));for(let a=0;a<common.length;a++)for(let b=a+1;b<common.length;b++){const oldA=previous.get(common[a].id),oldB=previous.get(common[b].id),distance=Math.hypot(oldA.x-oldB.x,oldA.y-oldB.y);if(distance>50)return Math.hypot(common[a].x-common[b].x,common[a].y-common[b].y)/distance;}throw Error('Two common visible graph nodes required for pinch proof.');}
async function colorProof(label,requiredScopes=Object.keys(palette)){
  await settle();const state=await snapshot(),colors=new Map((state.nodeColors||[]).map(value=>[value.node_id,typeof value.base_color==='number'?'#'+value.base_color.toString(16).padStart(6,'0'):value.base_color?.toLowerCase()]));
  for(const node of state.nodes)assert.equal(colors.get(node.id),palette[node.scope],'actual resolved style '+node.id);
  const projected=await page.locator('#memory-graph canvas').evaluate(canvas=>({targets:JSON.parse(canvas.dataset.nodeTargets),hitIds:JSON.parse(canvas.dataset.hitNodeIds||'[]'),selected:canvas.dataset.selectedNodeId}));
  const pose=state.cameraPose;assert.ok(pose);assert.ok(Math.abs(pose.position.x-pose.target.x)<.0001&&Math.abs(pose.position.y-pose.target.y)<.0001,'front-facing fixture radius contract');
  // Pinned real styled radius: chunk1.9/source3.8, z0/2, FOV50, native minima1/1.8CSS px.
  const units=2*Math.abs(pose.position.z-pose.target.z)*Math.tan(25*Math.PI/180)/state.graph.height;
  const samples=state.nodes.filter(node=>node.visible&&node.centerOwner===node.id).map(node=>{
    const target=projected.targets.find(value=>value.node_id===node.id);assert.ok(target?.visible,'actual TSL projection '+node.id);
    const global=node.scope==='global',base=Math.max(global?3.8:1.9,units*(global?1.8:1)),scale=(projected.selected===node.id?1.42:1)*(projected.hitIds.includes(node.id)?1.2:1);
    return{id:node.id,scope:node.scope,x:state.graph.x+target.x,y:state.graph.y+target.y,radius:base*scale*state.graph.height/(2*(pose.position.z-(global?2:0))*Math.tan(25*Math.PI/180))};
  }).filter(node=>node.x-node.radius>state.graph.x&&node.x+node.radius<state.graph.x+state.graph.width&&node.y-node.radius>state.graph.y&&node.y+node.radius<state.graph.y+state.graph.height);
  const saved=await page.locator('.memory-map-node').evaluateAll(nodes=>nodes.map(node=>{const previous=node.getAttribute('style');node.style.setProperty('opacity','0','important');return previous;}));
  let png;try{await settle();png=await page.screenshot();}finally{await page.locator('.memory-map-node').evaluateAll((nodes,saved)=>nodes.forEach((node,index)=>saved[index]===null?node.removeAttribute('style'):node.setAttribute('style',saved[index])),saved);}
  const pixels=await page.evaluate(measureNodeColorArea,{data:png.toString('base64'),samples,thresholds:NODE_COLOR_THRESHOLDS,viewport:state.viewport});
  const result=assessNodeColorArea(pixels,{requiredScopes});observations.push({colors:label,...result,palette,thresholds:NODE_COLOR_THRESHOLDS});
  assert.deepEqual(result.failures,[],'actual body area, not text or isolated tint: '+label);
}

try{
  const driver=process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE,chrome=process.env.MODEL_CHAT_BROWSER;
  if(!driver||!chrome)throw Error('Explicit prepared BROWSER_MODEL_PLAYWRIGHT_MODULE and MODEL_CHAT_BROWSER required.');
  if(phase==='after')sourcePaths.push('memory/navigation.mjs');
  await Promise.all([access(driver),access(chrome)]);
  if(live)await livePreflight();
  else{
    const prepared=resolve(root,'../rag-model-onboarding/.artifacts'),coreRoot=process.env.BROWSER_MEMORY_CORE_ROOT||join(prepared,'memory'),graphRoot=process.env.BROWSER_MEMORY_GRAPH_ROOT||join(prepared,'memory');
    await Promise.all([access(join(coreRoot,'rag-core.mjs')),access(join(graphRoot,'graph-renderer.mjs'))]);
    coreIdentity={sha256:digest(await readFile(join(coreRoot,'rag-core.mjs')))};graphIdentity={sha256:digest(await readFile(join(graphRoot,'graph-renderer.mjs')))};
    assert.equal(coreIdentity.sha256,'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6');
    if(phase==='before')assert.equal(graphIdentity.sha256,'c85fda05a2a6ac5596dc41f5f197064eb3063932eaf574ae93f5f7141d179edd');
    else{assert.match(process.env.BROWSER_MEMORY_EXPECTED_GRAPH_SHA256||'',/^[a-f0-9]{64}$/);assert.equal(graphIdentity.sha256,process.env.BROWSER_MEMORY_EXPECTED_GRAPH_SHA256);}
    sourceIdentity=await Promise.all(sourcePaths.map(async path=>({path,sha256:digest(await readFile(join(root,'examples/browser-model-chat',path)))})));
    server=await startServer({memoryCoreRoot:coreRoot,memoryGraphRoot:graphRoot,runtimeRoot:join(prepared,'model-chat/runtime')});base=new URL(server.url);
  }
  prior=await readFile(join(output,'receipt.json'),'utf8').then(JSON.parse).catch(cause=>{if(cause.code==='ENOENT')return null;throw cause;});
  if(phase==='after'){const baseline=prior?.before||prior;assert.equal(baseline?.phase,'before');assert.equal(baseline.status,'pass');assert.equal(baseline.screenshots[0].sha256,'13a6d4d182f77bb31e924d30086c2bfe97c644774406864058cc6cd1768bcc3d');}
  await mkdir(output,{recursive:true});if(live)cleanup.serverClosed=true;
  const {chromium}=await import(pathToFileURL(resolve(driver)).href);profile=await mkdtemp(join(tmpdir(),profilePrefix));
  context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,chromiumSandbox:true,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:1,viewport:{width:390,height:844},reducedMotion:'reduce',ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings']});
  browserVersion=context.browser()?.version();await context.exposeBinding('__mobileFixtureCall',async(_source,value)=>{if(value==='worker-attempt')workers++;else fixtureCalls.push(value);});
  await context.addInitScript(()=>{window.__mobileEvents=[];window.__mobileCameraFrames=0;window.Worker=class{constructor(){void window.__mobileFixtureCall('worker-attempt');throw Error('Worker forbidden in mobile no-model fixture.');}};
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click','touchstart','touchmove','touchend','touchcancel','dragstart','selectstart'])document.addEventListener(type,event=>{if(window.__mobileEvents.length<250)window.__mobileEvents.push({type,target:event.target.closest?.('[data-memory-node]')?.dataset.memoryNode||event.target.id||event.target.tagName,pointerType:event.pointerType||null,defaultPrevented:event.defaultPrevented,cancelable:event.cancelable});},true);
    document.addEventListener('rag-camera-frame',()=>window.__mobileCameraFrames++,true);
    const observer=new MutationObserver(()=>{const header=document.querySelector('#memory-dialog .memory-panel-header');if(header&&!document.getElementById('mobile-fixture-label')){const label=document.createElement('small');label.id='mobile-fixture-label';label.textContent=location.protocol==='https:'?'LIVE HTTPS / TOUCH UI FIXTURE - no model':'TOUCH UI FIXTURE - no model';label.style.cssText='position:absolute;bottom:0;left:12px;font:8px/10px ui-monospace;color:#ffedc8;pointer-events:none';header.style.position='relative';header.append(label);}});observer.observe(document,{childList:true,subtree:true});
  });
  await context.route('**/*',async route=>{const url=new URL(route.request().url()),path=url.pathname.startsWith(base.pathname)?url.pathname.slice(base.pathname.length)||'index.html':'';
    if(url.origin!==base.origin||/\/runtime\/|engine-worker\.mjs|\.gguf$/i.test(url.pathname)||route.request().resourceType()==='worker'||live&&!manifest.files.some(file=>file.path===path)){forbidden.push({path:url.pathname,origin:url.origin});return route.abort();}
    if(path==='runtime-adapter.mjs')return route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:adapter});
    if(!live)return route.continue();
    try{const {response,bytes}=await verifiedLiveAsset(path),headers={...Object.fromEntries(response.headers),'content-length':String(bytes.length)};delete headers['content-encoding'];delete headers['transfer-encoding'];
      servedAssets.push({path,sha256:digest(bytes),bytes:bytes.length});return route.fulfill({status:response.status,headers,body:bytes});
    }catch(cause){assetFailures.push({path,error:cause.message});return route.abort();}
  });
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',cause=>pageErrors.push(cause.message));page.on('worker',()=>workers++);session=await context.newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  if(live){await session.send('Network.clearBrowserCache');await session.send('Network.clearBrowserCookies');await session.send('Network.setCacheDisabled',{cacheDisabled:true});}
  await page.goto(new URL('?memory=1',base).href);await page.waitForFunction(()=>window.localMemoryPreview?.workspace.automaticMemory);
  await page.locator('#local-file').setInputFiles({name:'fixture-not-model.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('TOUCH UI FIXTURE ONLY')});await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready');
  for(const text of [longText,'The desk lamp is blue.']){await page.locator('#prompt').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready'&&!document.querySelector('.message.pending'));}
  await page.evaluate(async text=>{const w=window.localMemoryPreview.workspace;await w.automaticMemory.pinPersona({turnId:'t-0001',text});await w.persist();},longText);
  await tap('#memory-open');await page.waitForFunction(()=>document.getElementById('memory-graph').dataset.renderer==='tsl');await settle();
  await check('actual touch baseline has three authorized pocket types and an admitted TSL backend',async()=>{
    const scopes=await page.locator('[data-memory-node]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.dataset.memoryScope))].sort());assert.deepEqual(scopes,['conversation','global','persona']);
    if(phase==='before'){const path=join(output,'before.png');await page.screenshot({path});const bytes=await readFile(path);screenshots.push({path:'.artifacts/proof/memory-mobile/before.png',sha256:digest(bytes),bytes:bytes.length,fixture:true});console.log('BASELINE_IMAGE '+path);}
    else{assert.deepEqual(await page.locator('.memory-scope-legend [role="listitem"]').allTextContents(),['Conversation','Persona','Global']);await colorProof('idle');}
  });
  await check('empty-space touch pan and genuine two-contact pinch are observed without invented camera input',async()=>{
    const start=await blankPoint();const pan=await recordGesture('empty-canvas-pan',()=>swipe(start,{x:start.x+45,y:start.y+35}));if(phase==='after'){assertPan(pan.before,pan.after);await resetGraph();}
    const point=await blankPoint(true);const pinch=await recordGesture('two-contact-pinch',async()=>{
      const left={x:point.x-25,y:point.y,id:1},right={x:point.x+25,y:point.y,id:2};await touch('touchStart',[left,right]);
      for(let step=1;step<=6;step++){await touch('touchMove',[{...left,x:left.x-step*5},{...right,x:right.x+step*5}]);await pause(25);}await touch('touchEnd');await pause(100);await settle();
    });
    if(phase==='after'){stablePage(pinch.before,pinch.after);const ratio=pairScale(pinch.before,pinch.after);assert.ok(ratio>1.12||ratio<.88,'actual graph pair distances change under pinch');assert.notDeepEqual(pinch.after.cameraPose,pinch.before.cameraPose);assert.ok(!pinch.after.eventLog.some(event=>event.type==='pointercancel'));observations.push({pinchPairScale:ratio});await fitGraph();observations.push({fitRecovery:true});}
  });
  await check('overlay button tap, drag and cancel routes are captured',async()=>{
    await recordGesture('overlay-node-tap',()=>tap('[data-memory-node="turn:t-0003"]'));assert.equal(await page.locator('#memory-detail-title').textContent(),'Your message');await back();
    const box=await page.locator('[data-memory-node="turn:t-0003"]').boundingBox(),start={x:box.x+22,y:box.y+22};
    const drag=await recordGesture('overlay-node-drag',()=>swipe(start,{x:start.x+45,y:start.y+25}));if(phase==='after'){assertPan(drag.before,drag.after);const deltas=movement(drag.before,drag.after).moves;assert.ok(deltas.length>=2&&deltas.every(value=>Math.abs(value.dx-45)<2&&Math.abs(value.dy-25)<2),'overlay capture transfer must preserve the full continued45x25 drag');assert.equal(drag.after.detail.visible,false,'overlay drag does not activate a tap');await resetGraph();}await back();
    const empty=await blankPoint();await recordGesture('empty-canvas-cancel',()=>swipe(empty,{x:empty.x+20,y:empty.y+15},{cancel:true}));
    assert.equal(await page.locator('#memory-detail').isVisible(),false);observations.push({postCancelSelectionVisible:false});
    if(phase==='after'){await resetGraph();const target=await page.locator('[data-memory-node="turn:t-0003"]').boundingBox();const origin={x:target.x+22,y:target.y+22};
      const canceled=await recordGesture('overlay-node-cancel',()=>swipe(origin,{x:origin.x+12,y:origin.y+6},{cancel:true}));assert.equal(canceled.after.detail.visible,false,'canceled overlay must not click');assert.ok(!canceled.after.eventLog.some(event=>event.type==='click'));
      await tap('[data-memory-node="turn:t-0003"]');assert.equal(await page.locator('#memory-detail').isVisible(),true,'fresh tap works after cancellation');await back();await resetGraph();
    }
  });
  await check('detail scroll, native text/drag surfaces, page overscroll and orientation are recorded',async()=>{
    await tap('[data-memory-node="turn:t-0001"]');const detail=await page.locator('#memory-detail').boundingBox();
    const scroll=await recordGesture('detail-native-scroll',()=>swipe({x:detail.x+detail.width/2,y:detail.y+detail.height-28},{x:detail.x+detail.width/2,y:detail.y+32}));
    if(phase==='after'){assert.ok(scroll.after.detail.scrollTop>scroll.before.detail.scrollTop+20,'detail retains native scrolling');assert.equal(scroll.after.page.y,0);
      await back();await tap('[data-memory-node="turn:t-0001"]');await page.locator('#memory-detail').evaluate(node=>{node.scrollTop=0;});await settle();
      const text=await page.locator('#memory-detail-text').boundingBox(),panel=await page.locator('#memory-detail').boundingBox(),lineY=Math.max(text.y+12,panel.y+16);assert.ok(lineY<panel.y+panel.height-30,'source line visible');
      await page.mouse.move(text.x+2,lineY);await page.mouse.down();await page.mouse.move(text.x+160,lineY,{steps:8});await page.mouse.up();const selection=await page.evaluate(()=>({text:getSelection()?.toString()||'',source:Boolean(getSelection()?.anchorNode?.parentElement?.closest('#memory-detail-text'))}));assert.ok(selection.source&&selection.text.trim().length>0&&longText.includes(selection.text.trim()),'source detail remains natively selectable');observations.push({detailSelection:{input:'native mouse drag in touch-emulated viewport',length:selection.text.length,sha256:digest(selection.text)}});await page.evaluate(()=>getSelection()?.removeAllRanges());
    }
    await back();const heading=await page.locator('#memory-title').boundingBox();await recordGesture('heading-native-longpress-drag',()=>swipe({x:heading.x+12,y:heading.y+heading.height/2},{x:heading.x+70,y:heading.y+heading.height/2},{hold:650}));
    await page.evaluate(()=>getSelection()?.removeAllRanges());const empty=await blankPoint();await recordGesture('page-overscroll-boundary',()=>swipe(empty,{x:empty.x,y:Math.min(800,empty.y+140)}));if(phase==='after')await resetGraph();
    await page.setViewportSize({width:844,height:390});await settle();observations.push(compactObservation({orientation:'landscape',state:await snapshot()}));await page.setViewportSize({width:390,height:844});await settle();
  });
  if(phase==='after')await check('scope colors survive real search, selection, resize, reduced motion and keyboard/source actions',async()=>{
    await colorProof('after-orientation');await page.locator('#memory-query').fill('copper notebooks');await page.locator('#memory-query').press('Enter');await page.waitForFunction(()=>!document.getElementById('memory-query').disabled&&document.querySelector('[data-memory-node][data-matched="true"]'));await colorProof('real-search');
    await liftNode('persona:p-0001');await page.locator('[data-memory-node="persona:p-0001"]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#memory-detail-text').textContent(),longText);await colorProof('selected-persona',['persona']);
    await page.locator('#memory-back').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.dataset.memoryNode),'persona:p-0001');await fitGraph();
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='true');await colorProof('normal-motion');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='false');await colorProof('reduced-motion');
    await page.locator('[data-memory-node="persona:p-0001"]').focus();await settle();const name=live?'live-after.png':'after.png',path=join(output,name);await page.screenshot({path});const bytes=await readFile(path);screenshots.push({path:'.artifacts/proof/memory-mobile/'+name,sha256:digest(bytes),bytes:bytes.length,fixture:true});
    await page.keyboard.press('Enter');await page.locator('#memory-detail-sources [data-memory-source]').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'turn-t-0001');
    const outside=await page.evaluate(()=>{const target=document.elementFromPoint(195,350),ancestors=[];for(let item=target;item;item=item.parentElement)ancestors.push({tag:item.tagName,touchAction:getComputedStyle(item).touchAction});return{inGraph:Boolean(target.closest('#memory-graph')),ancestors,viewportMeta:document.querySelector('meta[name="viewport"]').content};});assert.equal(outside.inGraph,false);assert.ok(outside.ancestors.every(value=>value.touchAction!=='none'));assert.doesNotMatch(outside.viewportMeta,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,\s]|$)/i);
    const nativeZoomBefore=await page.evaluate(()=>visualViewport.scale);await session.send('Input.synthesizePinchGesture',{x:195,y:350,scaleFactor:1.3,relativeSpeed:400,gestureSourceType:'touch'});await pause(120);const nativeZoomAfter=await page.evaluate(()=>visualViewport.scale);let control;
    if(nativeZoomAfter<=nativeZoomBefore+.1){control=await nativeZoomControl();assert.ok(control.after<=control.before+.1,'native control can zoom but app cannot');limitations.push('Outside-graph native page pinch is unqualified: both app and a plain native control remained at scale1 in this Chrome/CDP host.');}
    observations.push({outsideGraphPageZoom:{before:nativeZoomBefore,after:nativeZoomAfter,nativeZoomQualified:nativeZoomAfter>nativeZoomBefore+.1,input:'CDP native touch pinch',outside,control}});if(nativeZoomAfter!==nativeZoomBefore)await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await settle();
  });
  if(phase==='after')await check('a real default renderer instance retains legacy family colors and explicit fit',async()=>{
    const result=await page.evaluate(async()=>{const module=await import('./memory/graph-renderer.mjs'),canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:160px;height:160px;z-index:-1;pointer-events:none';document.body.append(canvas);let renderer;const failures=[];
      try{renderer=await module.createTslRagGraphRenderer({canvas,onNodeActivate(){},onTerminalFailure:value=>failures.push(value)});renderer.setMotionEnabled(false);
        const graph={view:'evidence',nodes:[{id:'legacy-a',kind:'chunk',record_id:'fixture-a',source_id:'fixture-a',path:'legacy/a',x:-50,y:0},{id:'legacy-b',kind:'chunk',record_id:'fixture-b',source_id:'fixture-b',path:'legacy/b',x:50,y:0}],links:[],total_nodes:2,total_links:0,omitted_nodes:0,omitted_links:0,clipped:false,layout_steps:0,layout_ms:0,request_generation:0};renderer.render(graph);await new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept)));const initial=renderer.getCameraPose();renderer.setInteractionState('legacy-a',['legacy-b']);const colors=renderer.diagnostics().node_colors;renderer.setCameraPose({position:{...initial.position,x:initial.position.x+1000},target:{...initial.target,x:initial.target.x+1000}});renderer.fit();await new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept)));return{backend:renderer.backend,initial,fitted:renderer.getCameraPose(),colors,failures};
      }finally{renderer?.dispose();canvas.remove();}});
    assert.ok(['webgpu','webgl2'].includes(result.backend));assert.deepEqual(result.failures,[]);assert.equal(result.colors.length,2);assert.ok(result.colors.every(value=>Number.isInteger(value.base_color)&&!Object.values(palette).some(hex=>parseInt(hex.slice(1),16)===value.base_color)),'mobile scope colors stay opt-in');assert.ok(Math.abs(result.fitted.target.x-result.initial.target.x)<.01,'explicit fit restores legacy framing');observations.push({defaultWrapper:result});
  });
  if(phase==='after')await check('real graph-disabled list fallback leaves native node tap and details available',async()=>{
    const fallback=await context.newPage();fallback.on('pageerror',cause=>pageErrors.push(cause.message));fallback.on('worker',()=>workers++);
    try{await fallback.goto(new URL('?memory=1&graph=0',base).href);await fallback.waitForFunction(()=>window.localMemoryPreview?.workspace);await fallback.locator('#local-file').setInputFiles({name:'fixture-not-model.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('TOUCH UI FIXTURE ONLY')});await fallback.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready');await fallback.locator('#memory-open').tap();await fallback.waitForFunction(()=>document.getElementById('memory-graph').dataset.renderer==='list');assert.equal(await fallback.locator('#memory-graph canvas').isVisible(),false);assert.notEqual(await fallback.locator('#memory-graph').evaluate(node=>getComputedStyle(node).touchAction),'none');await fallback.locator('[data-memory-node="turn:t-0003"]').tap();assert.equal(await fallback.locator('#memory-detail-text').textContent(),'The desk lamp is blue.');observations.push({fallback:{kind:'actual graph=0 list assembly',nativeTap:true,unavailableGpuSimulated:false}});}finally{await fallback.close();}
  });
  await check('no native/model/network/Worker activity; canonical messages and pinned source stay intact',async()=>{
    assert.deepEqual(forbidden,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(assetFailures,[]);assert.equal(workers,0);
    assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.snapshot().turns[0].content),longText);
    assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.automaticMemory.snapshot().nodes.find(node=>node.id==='persona:p-0001')?.text),longText);
    if(live){for(const path of [...sourcePaths,'index.html','memory/rag-core.mjs','memory/graph-renderer.mjs'])assert.ok(servedAssets.some(value=>value.path===path),'Actual browser requested verified '+path);
      const final=await liveAsset('site-manifest.json',128*1024);assert.equal(digest(final.bytes),preflight.manifestSha256,'Manifest stable through live checks');
    }else{
      if(phase==='after')for(const [path,expected] of [['memory/navigation.mjs',sourceIdentity.find(value=>value.path==='memory/navigation.mjs').sha256],['memory/rag-core.mjs',coreIdentity.sha256],['memory/graph-renderer.mjs',graphIdentity.sha256]]){const response=await fetch(new URL(path,base)),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.equal(digest(bytes),expected,'actual served '+path);servedAssets.push({path,sha256:expected,bytes:bytes.length});}
      assert.deepEqual(await Promise.all(sourcePaths.map(async path=>({path,sha256:digest(await readFile(join(root,'examples/browser-model-chat',path)))}))),sourceIdentity);
    }
  });
}catch(cause){error=cause.message;console.error(cause.stack||cause.message);process.exitCode=1;
  if(phase==='after'&&page&&!screenshots.length){const name=live?'live-after.png':'after.png',path=join(output,name);await page.screenshot({path});const bytes=await readFile(path);screenshots.push({path:'.artifacts/proof/memory-mobile/'+name,sha256:digest(bytes),bytes:bytes.length,fixture:true,failedState:true});}
}
finally{
  const cleanupFailure=cause=>{error=error||'Owned resource cleanup failed: '+cause.message;process.exitCode=1;observations.push({cleanupError:cause.message});};
  if(context)await context.close().then(()=>{cleanup.contextClosed=true;},cleanupFailure);
  if(server)await server.close().then(()=>{cleanup.serverClosed=true;},cleanupFailure);
  if(profile&&dirname(profile)===resolve(tmpdir())&&basename(profile).startsWith(profilePrefix))await rm(profile,{recursive:true,force:true}).then(()=>{cleanup.ownedProfileRemoved=true;},cleanupFailure);
  await mkdir(output,{recursive:true});
  if(live){
    const movementSummary=name=>{const value=observations.find(item=>item.gesture===name);return value?{maximumPixels:value.movement.maximumPixels,viewportScaleBefore:value.movement.viewportScaleBefore,viewportScaleAfter:value.movement.viewportScaleAfter,
      ...(name==='overlay-node-drag'?{firstMove:value.movement.moves.first[0],lastMove:value.movement.moves.last[0]}:{})}:null;};
    const detail=observations.find(item=>item.gesture==='detail-native-scroll'),zoom=observations.find(item=>item.outsideGraphPageZoom)?.outsideGraphPageZoom;
    const summary={schema:'memory-mobile-live-proof/v1',status:error?'fail':'pass',url:base?.href,durationMs:Date.now()-started,browserVersion,harnessSha256,preflight,graphSha256:graphIdentity?.sha256,checks,
      observations:{sha256:digest(JSON.stringify(observations)),pan:movementSummary('empty-canvas-pan'),overlayDrag:movementSummary('overlay-node-drag'),pinchPairScale:observations.find(item=>item.pinchPairScale)?.pinchPairScale,fitRecovery:observations.some(item=>item.fitRecovery),
        nativeDetailScrollDelta:detail?detail.after.detail.scrollTop-detail.before.detail.scrollTop:null,scopeColors:palette,renderedScopeTintChecks:observations.filter(item=>item.colors).length,sourceDetailSelectable:Boolean(observations.find(item=>item.detailSelection)),fallbackNativeTap:Boolean(observations.find(item=>item.fallback)?.fallback.nativeTap),outsideGraphNativePageZoomQualified:Boolean(zoom?.nativeZoomQualified)},
      assets:{verifiedBrowserResponses:servedAssets.length,uniquePaths:new Set(servedAssets.map(value=>value.path)).size,identitySha256:digest(JSON.stringify(servedAssets)),failures:assetFailures.length,network},
      fixtureCalls:Object.fromEntries(['prepare','measure','reply'].map(kind=>[kind,fixtureCalls.filter(value=>value===kind).length])),screenshots,error,
      boundary:{liveHttps:true,productionBootstrapReplaced:false,productionBrowserBytesVerified:true,runtimeAdapterOnlyFixture:true,realStores:true,realCore:true,realTsl:true,cdpTouchContacts:true,physicalDevice:false,iosQualified:false,nativeInference:false,modelLoaded:false,modelDownloads:0,runtimeWasmFetched:false,workers,unexpectedRequests:forbidden.length},cleanup,limitations};
    assert.ok(Buffer.byteLength(JSON.stringify(summary))<=4*1024,'Live browser summary stays within4KiB');
    const retained=JSON.parse(await readFile(join(output,'receipt.json'),'utf8'));assert.equal(retained.status,'pass','Retain verified local proof');retained.publicationLiveBrowser=summary;
    const bytes=JSON.stringify(retained)+'\n';assert.ok(Buffer.byteLength(bytes)<=64*1024,'Single receipt stays within64KiB');await writeFile(join(output,'receipt.json'),bytes);
  }else{
  const receipt={schema:'memory-mobile-touch-proof/v1',phase,status:error?'fail':'pass',durationMs:Date.now()-started,browserVersion,harnessSha256,sourceIdentity,coreIdentity,graphIdentity,servedAssets,checks,observations,screenshots,error,fixtureCalls,limitations,...(error&&lastGesture?{failureGesture:lastGesture.gesture}:{}),
    coverage:{browserActions:['CDP contact pan/pinch/tap/drag/cancel','overlay cancel and fresh-tap recovery','Fit','native detail scroll','native mouse detail selection','keyboard/source actions','idle orientation resize','rendered scope tint/search/selection/reduced-motion'],unitOnlyInterruptions:['active blur/hidden/resize','third contact','pinch-to-one-contact continuation','explicit graph-surface capture loss','inactive renderer/disposal','wheel bounds'],actualImageElements:0},
    boundary:{localOnly:true,productionBootstrapReplaced:false,adapterReplacedByLabeledFixture:true,realStores:true,realCore:true,realTsl:true,cdpTouchContacts:true,physicalDevice:false,iosQualified:false,nativeInference:false,modelLoaded:false,modelDownloads:0,runtimeWasmFetched:false,workers,unexpectedRequests:forbidden.length},cleanup,
    ...(phase==='after'&&prior?{before:prior.before||prior}:{})};
  for(const part of [receipt.before,receipt])for(const observation of part?.observations||[])for(const snapshot of [observation.before,observation.after])if(snapshot){if(snapshot.selection?.length===0)snapshot.selection={length:0};if(observation.gesture!=='empty-canvas-pan'){delete snapshot.canvas;delete snapshot.images;}}
  if(Buffer.byteLength(JSON.stringify(receipt))>56*1024){for(const part of [receipt.before,receipt])for(const observation of part?.observations||[])if(observation.gesture&&!['empty-canvas-pan','two-contact-pinch'].includes(observation.gesture)){delete observation.after.events.first;delete observation.after.events.last;delete observation.after.nodeProjection.first;delete observation.after.nodeProjection.last;}receipt.retentionTrimmedExamples=true;}
  if(Buffer.byteLength(JSON.stringify(receipt))>64*1024){receipt.status='fail';receipt.error=(receipt.error?receipt.error+' ':'')+'Compact receipt exceeds64KiB bound.';process.exitCode=1;}
  await writeFile(join(output,'receipt.json'),JSON.stringify(receipt)+'\n');
  }
}
