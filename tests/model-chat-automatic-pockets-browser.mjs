#!/usr/bin/env node
// Manifest-bound staged/live production bootstrap, pockets, RAG and panel.
// Runtime adapter alone is a labeled fixture. No model, native tokenizer,
// runtime/WASM fetch, provider endpoint, install or publication operation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const resultPath = join(output, 'automatic-browser-result.json');
const profilePrefix = 'rag-automatic-pockets-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const failureSummary = value => String(value||'').replace(/\u001b\[[0-9;]*m/g,'').split('\n').slice(0,9).filter(line=>!line.trim().startsWith('at ')).join('\n');
const memoryFiles = ['workspace','store','events','context','structured-context','automatic-context','rag-adapter',
  'restore-events','citations','panel','navigation','rag-core','graph-renderer','automatic-memory','conversation-index','scoped-pockets','starter-facts']
  .map(name=>'memory/'+name+'.mjs').concat('memory/panel.css');
const payloadPaths = ['index.html','style.css','app.mjs','loader-controller.mjs','model-contract.mjs','runtime-adapter.mjs',
  'engine-worker.mjs','runtime-errors.mjs','wasm-memory.mjs','runtime-profile.mjs','capabilities.mjs','bootstrap.mjs',
  'theme/aurel-gold.css','runtime/index.js','runtime/wllama.wasm','runtime/LICENSE','runtime/compat/wllama.js',
  'runtime/compat/wllama.wasm','LICENSES/rag-method.txt','LICENSES/lfm-open-license-1.0.txt','LICENSES/forcegraph-tsl.txt',
  'LICENSES/three.txt','NOTICE.txt','README.txt',...memoryFiles].sort();
const mime = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.mjs':'application/javascript',
  '.json':'application/json','.wasm':'application/wasm','.txt':'text/plain'};
const browserAssets = new Map(), assetFailures = [], network = {requests:0,bytes:0};
const checks = [], observations = [], screenshots = [], events = [], forbidden = [], pageErrors = [], priorAttempts = [];
const cleanup = { contextClosed:false, serverClosed:false, ownedProfileRemoved:false };
let context, server, profile, error, sourceIdentity, browserVersion, base, manifest, manifestSha256, mode, workers = 0;
let preflight = {status:'pending'};
const started = Date.now();
const harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
const fred = 'I have been describing ordinary details about a project and how I prefer to keep my notes, without special fact labels. '.repeat(2)
  + 'My name is Fred. I prefer copper notebooks. These are my own words about myself, and not an externally verified fact.';
const corrected = 'My name is Felix. I prefer blue notebooks.';
const fixtureModule = `
const fixture=window.__pocketsFixture={label:'UI FIXTURE — deterministic replies and character-cost meter; no model loaded',calls:[],requests:[],measurements:[]};
const report=async item=>{fixture.calls.push(item.kind);await window.__recordPocketFixture(item);};
export function createRuntimeAdapter(){return {
 async prepare(){await report({kind:'prepare',fixture:true});return{cached:false,modelId:'LABELED-UI-FIXTURE-NOT-A-MODEL',runtimeProfile:'memory64'};},
 async measure(messages){const promptTokens=16+messages.reduce((sum,item)=>sum+Math.ceil(item.content.length/2)+8,0);const result={promptTokens,contextTokens:2048,overflow:promptTokens>2048};fixture.measurements.push(result);await report({kind:'measure',...result,fixture:true});return result;},
 async reply(messages,options={}){await options.beforeDispatch?.();await options.onDispatch?.();fixture.requests.push(structuredClone(messages));await report({kind:'reply',fixture:true,messageCount:messages.length});const text='Fixture response: generated text, not a verified fact.';options.onToken?.(text);return text;},
 async dispose(){await report({kind:'dispose',fixture:true});}
};}
`;

function required(name,pattern) {
  const value=process.env[name]?.trim();
  if(!value||pattern&&!pattern.test(value))throw Error('Set '+name+' explicitly to the reviewed value.');return value;
}
function inside(parent,path) {
  const suffix=relative(parent,path);return suffix!==''&&suffix!=='..'&&!suffix.startsWith('..'+sep)&&!isAbsolute(suffix);
}
function mimeMatches(path,value) {
  const type=value?.split(';')[0].trim().toLowerCase(),expected=mime[extname(path)]||'text/plain';
  return type===expected||(expected==='application/javascript'&&type==='text/javascript');
}
async function startPackageServer(directory) {
  const canonical=await realpath(resolve(directory)),allowed=new Set([...payloadPaths,'site-manifest.json']);
  assert.equal(canonical,resolve(directory),'staged root has no linked ancestor');
  const owned=createServer(async(request,response)=>{
    try {
      let pathname;try{pathname=decodeURIComponent(request.url.split(/[?#]/)[0]);}catch{pathname='';}
      const name=pathname.startsWith('/model-chat/')?pathname.slice('/model-chat/'.length)||'index.html':'';
      if(!['GET','HEAD'].includes(request.method)||!allowed.has(name)){
        response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
        response.end(request.method==='HEAD'?undefined:'Not found');return;
      }
      const target=join(canonical,name),resolved=await realpath(target),info=await lstat(target);
      assert.ok(inside(canonical,resolved)&&resolved===target&&info.isFile()&&!info.isSymbolicLink(),'ordinary contained packaged file');
      const bytes=await readFile(target),type=mime[extname(name)]||'application/octet-stream';
      response.writeHead(200,{'Content-Type':type+(/^(?:text\/|application\/(?:javascript|json)$)/.test(type)?'; charset=utf-8':''),
        'Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
      response.end(request.method==='HEAD'?undefined:bytes);
    }catch{response.writeHead(500,{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'});response.end('Package read failed');}
  });
  await new Promise((accept,reject)=>{owned.once('error',reject);owned.listen(0,'127.0.0.1',accept);});return owned;
}
async function boundedResponse(response,limit) {
  const chunks=[];let count=0;
  if(response.body){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;
    count+=part.value.byteLength;network.bytes+=part.value.byteLength;if(count>limit||network.bytes>16*1024*1024){await reader.cancel();throw Error('Finite16MiB static-asset budget exceeded.');}chunks.push(Buffer.from(part.value));
  }}finally{reader.releaseLock();}}
  return Buffer.concat(chunks);
}
async function request(path,method='GET',limit=128*1024) {
  if(++network.requests>300)throw Error('Finite300-request proof budget exceeded.');
  const target=new URL(path,base);assert.equal(target.origin,base.origin);assert.ok(target.pathname.startsWith(base.pathname));
  const response=await fetch(target,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  assert.equal(response.url,target.href,'no asset redirect');return{response,bytes:await boundedResponse(response,limit)};
}
async function verifyManifest(expectedSha,expectedHead,expectedFingerprint) {
  const {response,bytes}=await request('site-manifest.json');assert.equal(response.status,200);assert.ok(mimeMatches('site-manifest.json',response.headers.get('content-type')));
  manifestSha256=digest(bytes);assert.equal(manifestSha256,expectedSha);manifest=JSON.parse(bytes);
  const {identitySha256,...body}=manifest;assert.equal(identitySha256,digest(JSON.stringify(body)));
  assert.equal(manifest.schema,'rag-model-chat-static/v1');assert.equal(manifest.memoryPreview,true);assert.equal(manifest.publicReleaseQualified,false);
  assert.equal(manifest.model.weightsIncluded,false);assert.equal(manifest.source.head,expectedHead);assert.equal(manifest.source.dirty,false);
  assert.equal(manifest.source.fingerprintSha256,expectedFingerprint);assert.equal(expectedFingerprint,digest(JSON.stringify(manifest.source.files)));
  assert.deepEqual(manifest.files.map(file=>file.path).sort(),payloadPaths);assert.equal(payloadPaths.length,42);
  for(const file of manifest.files){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0);}
  for(const [path,hash] of Object.entries({'memory/rag-core.mjs':'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6',
    'memory/graph-renderer.mjs':'90783080f8ce7849f5d0544864c7ac7bfb7875c689aecf1fa7951204b4112b3a',
    'LICENSES/lfm-open-license-1.0.txt':'30adf9d6478191fb87f2424f63ba0728598335aaf99cd2848ef17e8e545fe94b'}))assert.equal(manifest.files.find(file=>file.path===path)?.sha256,hash,path);
  sourceIdentity={head:expectedHead,fingerprintSha256:expectedFingerprint,manifestSha256,identitySha256};
  // Exercise this standalone nested server separately from any repo server.
  // The adapter's original bytes are verified here before its labeled override.
  for(const path of ['bootstrap.mjs','runtime-adapter.mjs']){
    const file=manifest.files.find(file=>file.path===path),get=await request(path,'GET',file.bytes),head=await request(path,'HEAD',0);
    assert.equal(get.response.status,200);assert.ok(mimeMatches(path,get.response.headers.get('content-type')));assert.equal(get.bytes.length,file.bytes);assert.equal(digest(get.bytes),file.sha256);
    assert.equal(head.response.status,200);assert.ok(mimeMatches(path,head.response.headers.get('content-type')));assert.equal(head.bytes.length,0);
  }
  for(const path of ['memory/PRIVATE_LOCAL_ONLY','memory/serve-local.mjs','.git/config','.env','tests/model-chat-automatic-pockets-browser.mjs','node_modules/playwright/index.mjs']){
    const result=await request(path,'HEAD',0);assert.equal(result.response.status,404,path);assert.equal(result.bytes.length,0);
  }
  preflight={status:'pass',manifestSha256,sourceHead:expectedHead,sourceFingerprint:expectedFingerprint,payloadFiles:42,totalFiles:43,nestedPrefix:base.pathname,privateProbes:6,bootstrapAndOriginalAdapterVerified:true};
}

async function check(name, run) {
  const start = Date.now();
  try { await run(); checks.push({name,status:'pass',durationMs:Date.now()-start}); console.log('PASS automatic pockets: '+name); }
  catch(cause) { checks.push({name,status:'fail',durationMs:Date.now()-start,message:cause.message}); throw cause; }
}
const node = id => `[data-memory-node="${id}"]`;
async function settle(page) { await page.evaluate(()=>new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept)))); }
async function ready(page) {
  await page.locator('#local-file').setInputFiles({name:'fixture-not-model.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('LABELED UI FIXTURE ONLY')});
  await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready'); await settle(page);
}
async function send(page,text) {
  const previous=events.filter(item=>item.kind==='reply').length;
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await page.waitForFunction(()=>document.getElementById('app').dataset.phase==='ready'&&!document.querySelector('.message.pending'));
  assert.equal(events.filter(item=>item.kind==='reply').length,previous+1,'one accepted submit makes exactly one fixture reply');
  assert.equal(await page.locator('.message.interrupted').count(),0,await page.locator('#chat-error').textContent());
}
async function open(page) {
  if(!await page.locator('#memory-dialog').evaluate(dialog=>dialog.open))await page.locator('#memory-open').click();
  await page.waitForFunction(()=>['tsl','list','empty'].includes(document.getElementById('memory-graph').dataset.renderer));
  await settle(page);
}
async function back(page) { if(await page.locator('#memory-back').isVisible())await page.locator('#memory-back').click(); await settle(page); }
async function close(page) { if(await page.locator('#memory-dialog').evaluate(dialog=>dialog.open))await page.locator('#memory-close').click(); }
async function scope(page,value) {
  await back(page); await page.locator('#memory-pocket').selectOption(value);
  await page.waitForFunction(value=>window.localMemoryPreview.workspace.automaticMemory.getScope()===value&&!document.getElementById('memory-pocket').disabled,value);
  await settle(page);
}
async function search(page,text) {
  await back(page); await page.locator('#memory-query').fill(text); await page.locator('#memory-query').press('Enter');
  await page.waitForFunction(()=>!document.getElementById('memory-query').disabled&&!document.getElementById('memory-status').hidden);
  await settle(page);
}
async function matched(page) { return page.locator('[data-memory-node][data-matched="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.memoryNode).sort()); }
async function select(page,id) {
  await page.locator(node(id)).click(); await page.locator('#memory-detail-text').waitFor({state:'visible'});
  assert.equal(await page.locator(node(id)).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-memory-node][aria-pressed="true"]').count(),1);
}
async function capture(page,name) {
  assert.equal(name,'after','one essential source-detail image per mode');
  const filename='automatic-'+mode+'.png',path=join(output,filename);await page.screenshot({path});const bytes=await readFile(path);
  screenshots.push({path:'.artifacts/proof/model-chat/'+filename,bytes:bytes.length,sha256:digest(bytes),fixture:true});
}
async function geometry(page,label) {
  await settle(page);
  const state=await page.evaluate(()=>{
    const dialog=document.getElementById('memory-dialog'),body=dialog.querySelector('.memory-panel-body'),rect=dialog.getBoundingClientRect();
    const targets=[...dialog.querySelectorAll('button,a,input,select,textarea')].filter(item=>item.getClientRects().length).map(item=>{
      const r=item.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      return{id:item.id||item.dataset.memoryNode,x:r.x,y:r.y,w:r.width,h:r.height,node:item.dataset.memoryNode,nodeX:item.style.getPropertyValue('--node-x'),nodeY:item.style.getPropertyValue('--node-y'),centerVisible:x>=0&&x<innerWidth&&y>rect.y+70&&y<rect.bottom-5,owner:document.elementFromPoint(x,y)?.closest('[data-memory-node]')?.dataset.memoryNode};
    });const map=document.getElementById('memory-graph').getBoundingClientRect(),canvas=document.querySelector('#memory-graph canvas').getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight},rect:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom},map:{x:map.x,y:map.y,width:map.width,height:map.height},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},bodyWidth:body.clientWidth,bodyScroll:body.scrollWidth,documentWidth:document.documentElement.scrollWidth,targets};
  });
  observations.push({geometry:label,...state});
  assert.ok(state.rect.x>=-1&&state.rect.y>=-1&&state.rect.right<=state.viewport.width+1&&state.rect.bottom<=state.viewport.height+1,label+' dialog containment');
  assert.ok(state.documentWidth<=state.viewport.width+1&&state.bodyScroll<=state.bodyWidth+1,label+' horizontal containment');
  for(const target of state.targets){assert.ok(target.w>=43.5&&target.h>=43.5,label+' target '+JSON.stringify(target));if(target.node&&target.centerVisible)assert.equal(target.owner,target.node,label+' center ownership '+JSON.stringify(target));}
}
try {
  const driver=required('BROWSER_MODEL_PLAYWRIGHT_MODULE'),chrome=required('MODEL_CHAT_BROWSER');
  const expectedManifest=required('BROWSER_MEMORY_EXPECTED_MANIFEST_SHA256',/^[a-f0-9]{64}$/),expectedHead=required('BROWSER_MEMORY_EXPECTED_SOURCE_HEAD',/^[a-f0-9]{40}$/),expectedFingerprint=required('BROWSER_MEMORY_EXPECTED_SOURCE_FINGERPRINT',/^[a-f0-9]{64}$/);
  const site=process.env.BROWSER_MEMORY_PREVIEW_SITE?.trim(),url=process.env.BROWSER_MEMORY_PREVIEW_URL?.trim();
  assert.ok(Boolean(site)!==Boolean(url),'set exactly one reviewed staged-site or live-HTTPS target');
  await Promise.all([access(driver),access(chrome)]);
  if(site){mode='local';assert.ok(inside(join(root,'.artifacts/model-chat'),resolve(site)),'stage stays in existing artifact parent');server=await startPackageServer(site);base=new URL('http://127.0.0.1:'+server.address().port+'/model-chat/');}
  else{mode='live';base=new URL(url);assert.equal(base.href,'https://shoozes.github.io/rag-method-alpha/model-chat/','reviewed experimental Pages destination');cleanup.serverClosed=true;}
  await mkdir(output,{recursive:true});
  const previous=await readFile(resultPath,'utf8').then(JSON.parse).catch(cause=>{if(cause.code==='ENOENT')return null;throw cause;});
  const retained=previous?.priorAttempts||[];
  if(retained.length)priorAttempts.push(...[retained[0],...retained.slice(Math.max(1,retained.length-1))].map(item=>({...item,error:failureSummary(item.error)})));
  if(previous?.status==='fail')priorAttempts.push({failedCheck:previous.checks?.find(item=>item.status==='fail')?.name,error:failureSummary(previous.error),sourceIdentity:previous.sourceIdentity,cleanup:previous.cleanup});
  await verifyManifest(expectedManifest,expectedHead,expectedFingerprint);
  const {chromium}=await import(pathToFileURL(resolve(driver)).href);
  profile=await mkdtemp(join(tmpdir(),profilePrefix));
  context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,chromiumSandbox:true,serviceWorkers:'block',viewport:{width:390,height:844},reducedMotion:'reduce',ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings']});
  browserVersion=context.browser()?.version()||'persistent Chrome';
  await context.exposeBinding('__recordPocketFixture',async(_source,value)=>{if(value.kind==='worker-attempt')workers++;else events.push(value);});
  await context.addInitScript(()=>{
    window.Worker=class{constructor(){void window.__recordPocketFixture({kind:'worker-attempt'});throw Error('Worker forbidden in no-model browser fixture');}};
    const observer=new MutationObserver(()=>{const header=document.querySelector('#memory-dialog .memory-panel-header');if(header&&!document.getElementById('automatic-fixture-label')){
      const badge=document.createElement('small');badge.id='automatic-fixture-label';badge.textContent='UI FIXTURE — no model';badge.style.cssText='position:absolute;bottom:0;left:12px;font:8px/10px ui-monospace;color:#ffedc8;pointer-events:none';header.style.position='relative';header.append(badge);
    }});observer.observe(document,{subtree:true,childList:true});
  });
  await context.route('**/*',async route=>{
    const target=new URL(route.request().url()),path=target.pathname.startsWith(base.pathname)?target.pathname.slice(base.pathname.length)||'index.html':'';
    const runtime=/^(?:runtime\/|engine-worker\.mjs$)|\.gguf$/i.test(path)||route.request().resourceType()==='worker';
    if(target.origin!==base.origin||!payloadPaths.includes(path)||runtime){forbidden.push({kind:'blocked-request',path:target.pathname,origin:target.origin,reason:runtime?'runtime-or-model':'outside-reviewed-assets'});return route.abort();}
    if(path==='runtime-adapter.mjs')return route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:fixtureModule});
    try{
      const expected=manifest.files.find(file=>file.path===path),{response,bytes}=await request(target.href,'GET',expected.bytes);
      assert.equal(response.status,200,path);assert.equal(response.url,target.href,'browser asset has no redirect');assert.ok(mimeMatches(path,response.headers.get('content-type')),path+' MIME');
      assert.equal(bytes.length,expected.bytes,path);assert.equal(digest(bytes),expected.sha256,path);
      const prior=browserAssets.get(path);browserAssets.set(path,{path,sha256:expected.sha256,bytes:expected.bytes,loads:(prior?.loads||0)+1});
      const headers={...Object.fromEntries(response.headers),'content-length':String(bytes.length)};delete headers['content-encoding'];delete headers['transfer-encoding'];
      return route.fulfill({status:response.status,body:bytes,headers});
    }catch(cause){assetFailures.push({path,error:cause.message});await route.abort();}
  });
  const page=context.pages()[0]||await context.newPage(); page.setDefaultTimeout(15000);
  context.on('page',page=>{page.on('pageerror',cause=>pageErrors.push(cause.message));page.on('worker',()=>workers++);});
  page.on('pageerror',cause=>pageErrors.push(cause.message));page.on('worker',()=>workers++);
  const session=await context.newCDPSession(page);await session.send('Network.clearBrowserCache');await session.send('Network.clearBrowserCookies');await session.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.goto(new URL('?memory=1',base).href); await page.waitForFunction(()=>window.localMemoryPreview?.workspace.automaticMemory);
  await check('01 default All pockets: NASA Global sources remain separate from user history',async()=>{
    const initial=await page.evaluate(()=>({scope:window.localMemoryPreview.workspace.automaticMemory.getScope(),snapshot:window.localMemoryPreview.workspace.automaticMemory.snapshot(),turns:window.localMemoryPreview.workspace.conversation.snapshot().turns}));
    assert.equal(initial.scope,'all');assert.equal(initial.turns.length,0);assert.equal(initial.snapshot.nodes.length,3);
    assert.ok(initial.snapshot.nodes.every(item=>item.kind==='global'&&item.role==='source'&&item.scope==='global'&&item.sourceURL.startsWith('https://science.nasa.gov/')));
    await ready(page);await open(page);assert.equal(await page.locator('#memory-pocket').inputValue(),'all');
    assert.equal(await page.locator('#memory-graph').getAttribute('data-renderer'),'tsl');
    observations.push({renderer:await page.locator('#memory-graph').getAttribute('data-backend'),globalStarterCount:3});
    await select(page,'global:starter-space-earth-orbit');assert.match(await page.locator('#memory-detail-provenance').textContent(),/NASA/);
    assert.equal(await page.locator('#memory-detail-sources a').getAttribute('href'),'https://science.nasa.gov/earth/facts/');
    await back(page);await close(page);
  });
  await check('02 accepted chat automatically creates exact user and generated-assistant nodes',async()=>{
    await send(page,fred);await open(page);await scope(page,'conversation');
    assert.equal(await page.locator('[data-memory-node]').count(),2);
    assert.equal(await page.locator(node('turn:t-0001')).getAttribute('data-memory-role'),'user');
    assert.equal(await page.locator(node('turn:t-0002')).getAttribute('data-memory-role'),'assistant');
    await select(page,'turn:t-0002');assert.match(await page.locator('#memory-detail-title').textContent(),/Assistant.*generated/);
    assert.equal(await page.locator('#memory-remember-persona').isVisible(),false);
    await back(page);await select(page,'turn:t-0001');assert.match(await page.locator('#memory-detail-provenance').textContent(),/Exact source words/);
    assert.equal(await page.locator('#memory-detail-text').textContent(),fred);
    await close(page);
  });
  await check('03 real RAG highlights current matches; no-match and Clear remove stale matches',async()=>{
    await open(page);await back(page);await search(page,'Fred copper notebooks');assert.deepEqual(await matched(page),['turn:t-0001']);
    await search(page,'xylophonicallyzzzz');assert.deepEqual(await matched(page),[]);
    await page.locator('#memory-query-clear').click();assert.deepEqual(await matched(page),[]);
    assert.equal(await page.locator('#memory-query').inputValue(),'');await close(page);
  });
  await check('04 older unmarked Fred source is retrieved into measured dispatch without extra replies',async()=>{
    await send(page,'The archive agenda concerns shelving, calibration and inventory. '.repeat(24));
    await send(page,'The report appendix discusses maintenance, timetable and equipment. '.repeat(24));
    await send(page,'What name and notebook preference did I give earlier?');
    const state=await page.evaluate(()=>({request:window.__pocketsFixture.requests.at(-1),measurements:window.__pocketsFixture.measurements,events:window.localMemoryPreview.workspace.events.list(),map:window.localMemoryPreview.workspace.automaticMemory.snapshot()}));
    // Query terms intentionally include name and notebook, not a synthetic Fact[] declaration.
    assert.ok(state.request[0].content.includes('My name is Fred.'),'actual dispatched quoted evidence includes older exact Fred words');
    assert.match(state.request[0].content,/not instructions or verified personal facts/);
    assert.ok(!state.request[0].content.includes('Fixture response:'),'generated assistant text excluded from evidence');
    assert.ok(state.events.some(item=>item.type==='context-dispatched'&&item.extractiveSources?.some(source=>source.turnId==='t-0001')));
    assert.ok(state.measurements.every(item=>item.contextTokens===2048));
    assert.ok(state.map.usedNodeIds.includes('turn:t-0001'),'dispatch marks actual selected source');
    observations.push({fixtureMeter:true,nativeTokenizer:false,latestPromptTokens:state.measurements.at(-1).promptTokens,olderSourceTurn:'t-0001',usedNodeIds:state.map.usedNodeIds});
  });
  await check('05 reload retains canonical IDs without duplicate nodes or autonomous provider calls',async()=>{
    const before=await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState());const replies=events.filter(item=>item.kind==='reply').length;
    await page.reload();await page.waitForFunction(()=>window.localMemoryPreview?.workspace.automaticMemory);
    assert.deepEqual(await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState()),before);
    assert.equal(events.filter(item=>item.kind==='reply').length,replies);await ready(page);await open(page);
    const ids=await page.locator('[data-memory-node]').evaluateAll(items=>items.map(item=>item.dataset.memoryNode));assert.equal(new Set(ids).size,ids.length);
    await scope(page,'global');assert.equal(await page.locator('[data-memory-kind="global"]').count(),3);
    assert.equal(await page.locator('[data-memory-kind="message"]').count(),0);await scope(page,'conversation');
  });
  await check('06 explicit Persona pin accepts exact user words; assistant origin is rejected',async()=>{
    await search(page,'Fred');await select(page,'turn:t-0001');const calls=events.length;
    await page.locator('#memory-remember-persona').click();await page.waitForFunction(()=>!document.getElementById('memory-pocket').disabled);
    assert.equal(events.length,calls,'pin has no provider or measurement call');await scope(page,'persona');
    assert.equal(await page.locator('[data-memory-kind="persona"]').count(),1);await select(page,'persona:p-0001');
    assert.equal(await page.locator('#memory-detail-text').textContent(),fred);
    const rejected=await page.evaluate(async()=>{try{await window.localMemoryPreview.workspace.automaticMemory.pinPersona({turnId:'t-0002',text:'Fixture response:'});return false;}catch{return true;}});assert.equal(rejected,true);
    await close(page);
  });
  await check('07 correction and forget tombstones survive reload while original messages remain',async()=>{
    await send(page,corrected);
    const correction=await page.evaluate(async text=>{const w=window.localMemoryPreview.workspace,turn=w.conversation.snapshot().turns.findLast(item=>item.role==='user');await w.automaticMemory.correctPersona({recordId:'p-0001',expectedVersion:1,turnId:turn.id,text});return turn.id;},corrected);
    await open(page);await scope(page,'persona');await select(page,'persona:p-0001');assert.equal(await page.locator('#memory-detail-text').textContent(),corrected);
    await page.locator('#memory-forget').click();await page.waitForFunction(()=>!document.getElementById('memory-pocket').disabled);
    assert.equal(await page.locator('[data-memory-kind="persona"]').count(),0);await scope(page,'conversation');
    await search(page,'Fred');assert.deepEqual(await matched(page),[]);assert.equal(await page.locator(node('turn:t-0001')).count(),0,'Persona tombstone excludes every prior source version');
    await search(page,'shelving');await select(page,'turn:t-0003');await page.locator('#memory-forget').click();await page.waitForFunction(()=>!document.getElementById('memory-pocket').disabled);
    await close(page);await page.reload();await page.waitForFunction(()=>window.localMemoryPreview?.workspace.automaticMemory);await ready(page);await open(page);
    await scope(page,'persona');assert.equal(await page.locator('[data-memory-kind="persona"]').count(),0);await scope(page,'conversation');await search(page,'Fred Felix shelving');assert.deepEqual(await matched(page),[]);
    const state=await page.evaluate(()=>({turns:window.localMemoryPreview.workspace.conversation.snapshot().turns,blocked:window.localMemoryPreview.workspace.automaticMemory.getBlockedTurnIds(),persona:JSON.parse(window.localMemoryPreview.workspace.automaticMemory.exportPersona())}));
    assert.equal(state.turns.find(item=>item.id==='t-0001').content,fred);assert.equal(state.turns.find(item=>item.id===correction).content,corrected);
    assert.ok(state.blocked.includes('t-0001')&&state.blocked.includes(correction)&&state.blocked.includes('t-0003'));assert.equal(state.persona.records.at(-1).status,'forgotten');
    assert.ok(state.turns.find(item=>item.id==='t-0003').content.includes('shelving'),'Conversation Forget preserves original transcript');
    await close(page);
  });
  await check('08 quota failure is explicitly session-only while canonical chat remains visible',async()=>{
    await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('private-'))throw new DOMException('Labeled fixture storage quota','QuotaExceededError');return window.__originalSetItem.call(this,key,value);};});
    await send(page,'This quota fixture remains in the current session.');
    assert.equal(await page.locator('#chat-error').isVisible(),true);assert.match(await page.locator('#chat-error').textContent(),/session.*saving failed/i);
    const result=await page.evaluate(()=>window.localMemoryPreview.workspace.persist());assert.equal(result.durable,false);assert.match(result.error,/quota/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem;});
    await page.evaluate(()=>window.localMemoryPreview.workspace.persist());
  });
  await check('09 memory=0 executes basic chat without workspace or automatic-memory bootstrap',async()=>{
    const other=await context.newPage();const modules=[];other.on('request',request=>modules.push(new URL(request.url()).pathname));
    await other.goto(new URL('?memory=0',base).href);await ready(other);assert.equal(await other.evaluate(()=>Boolean(window.localMemoryPreview)),false);
    assert.equal(await other.locator('#memory-open').count(),0);assert.ok(!modules.some(path=>path.startsWith(base.pathname+'memory/')));
    await send(other,'Basic chat opt-out fixture.');await other.close();
  });
  await check('10 320/390/430, landscape and desktop retain pointer and keyboard access',async()=>{
    await open(page);await scope(page,'all');await page.locator('#memory-query').fill('');
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:1280,height:900}]){
      await page.setViewportSize(viewport);await geometry(page,viewport.width+'x'+viewport.height);
    }
    await page.setViewportSize({width:390,height:844});await scope(page,'global');
    await page.locator(node('global:starter-space-earth-orbit')).focus();await page.keyboard.press('Enter');await page.locator('#memory-detail-text').waitFor({state:'visible'});
    await page.locator('#memory-back').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.memoryNode),'global:starter-space-earth-orbit');
    await scope(page,'conversation');await search(page,'quota');await select(page,'turn:t-0011');
    await page.locator('#memory-detail-sources [data-memory-source]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'turn-t-0011');
    await open(page);await back(page);
  });
  await check('11 real node birth and dynamic reduced motion honor browser preference',async()=>{
    await scope(page,'conversation');await page.locator('#memory-query').fill('');await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='false');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='true');
    const birthText='A new automatic node is born from this exact source message.';
    const birthTurnId=await page.evaluate(content=>window.localMemoryPreview.workspace.conversation.append({role:'user',content}).id,birthText);
    await page.waitForFunction(()=>Number(document.querySelector('#memory-graph canvas').dataset.spawnActive)>0);
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='false');
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(item=>item.playState==='running').length),0);
    await page.locator('#memory-query').fill('');await scope(page,'all');
    await search(page,'automatic node');assert.deepEqual(await matched(page),['turn:'+birthTurnId]);
    await select(page,'turn:'+birthTurnId);
    assert.equal(await page.locator('#memory-detail-title').textContent(),'Your message');
    assert.match(await page.locator('#memory-detail-provenance').textContent(),/Exact source words.*Current conversation/);
    assert.equal(await page.locator('#memory-detail-text').textContent(),birthText);
    assert.equal(await page.locator('#memory-detail-sources [data-memory-source]').getAttribute('href'),'#turn-'+birthTurnId);
    assert.equal(await page.locator(node('turn:'+birthTurnId)).getAttribute('data-matched'),'true');
    await settle(page);await capture(page,'after');
    observations.push({afterCapture:{query:'automatic node',sourceTurnId:birthTurnId,sourceSha256:digest(birthText),role:'user',scope:'conversation',selected:true,realRagMatched:true}});
    observations.push({motionSequence:[false,true,false],normalBirthObserved:true,fixtureAppend:true});
  });
  await check('12 manifest-bound production closure, zero model/runtime/Workers and clean teardown',async()=>{
    assert.equal(workers,0);assert.deepEqual(forbidden,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(assetFailures,[]);
    for(const path of ['index.html','bootstrap.mjs','app.mjs','loader-controller.mjs','style.css',...memoryFiles])assert.ok(browserAssets.has(path),'actual unreplaced production closure: '+path);
    assert.equal(browserAssets.has('runtime-adapter.mjs'),false,'sole explicitly replaced module');
    const retained=await request('site-manifest.json');assert.equal(digest(retained.bytes),manifestSha256,'reviewed source stays stable throughout journey');
    await page.evaluate(()=>{window.localMemoryPreview.workspace.dispose();for(const key of Object.keys(localStorage))if(key.startsWith('private-'))localStorage.removeItem(key);});
    await context.close();context=null;cleanup.contextClosed=true;
    if(server){await new Promise((accept,reject)=>{server.close(cause=>cause?reject(cause):accept());server.closeIdleConnections();});server=null;cleanup.serverClosed=true;}
    assert.equal(dirname(profile),resolve(tmpdir()));assert.ok(basename(profile).startsWith(profilePrefix));await rm(profile,{recursive:true,force:true});profile=null;cleanup.ownedProfileRemoved=true;
  });
} catch(cause) { error=cause.message;console.error(cause.stack||cause.message);process.exitCode=1; }
finally {
  if(context)await context.close().then(()=>{cleanup.contextClosed=true;},cause=>{observations.push({cleanupError:cause.message});});
  if(server)await new Promise((accept,reject)=>{server.close(cause=>cause?reject(cause):accept());server.closeIdleConnections();}).then(()=>{cleanup.serverClosed=true;},cause=>{observations.push({cleanupError:cause.message});});
  if(profile&&dirname(profile)===resolve(tmpdir())&&basename(profile).startsWith(profilePrefix))await rm(profile,{recursive:true,force:true}).then(()=>{cleanup.ownedProfileRemoved=true;},cause=>{observations.push({cleanupError:cause.message});});
  await mkdir(output,{recursive:true});
  const harnessUnchanged=digest(await readFile(fileURLToPath(import.meta.url)))===harnessSha256;
  if(!harnessUnchanged){error='Harness source changed during proof.';process.exitCode=1;}
  const receipt={schema:'automatic-pockets-public-browser-proof/v1',status:error?'fail':'pass',mode,durationMs:Date.now()-started,browserVersion,preflight,checks,observations,screenshots,sourceIdentity,harnessSha256,harnessUnchanged,priorAttempts,error,
    browserAssets:[...browserAssets.values()].sort((left,right)=>left.path.localeCompare(right.path)),assetFailures,staticHttp:network,
    fixtureCalls:{prepare:events.filter(item=>item.kind==='prepare').length,measure:events.filter(item=>item.kind==='measure').length,reply:events.filter(item=>item.kind==='reply').length},
    boundary:{stagedSourceFreeBrowser:mode==='local',liveHttps:mode==='live',freshOwnedProfile:Boolean(browserVersion),productionBootstrapReplaced:false,productionAssetsHashChecked:preflight.status==='pass'&&browserAssets.size>0&&!assetFailures.length,adapterReplacedByLabeledFixture:true,realStores:true,realRag:true,actualDispatchedMessages:true,nativeTokenizer:false,modelLoaded:false,nativeInference:false,unexpectedRequests:forbidden.length,workers,modelDownloads:0,runtimeWasmFetched:false,installs:0,publishOperations:0,deviceQualification:false},cleanup};
  await writeFile(resultPath,JSON.stringify(receipt,null,2)+'\n');
}
