#!/usr/bin/env node
// Local memory-dialog QA. Real stores/retrieval; explicitly labeled fixture.
// This harness never loads a model or executes a native provider/runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../examples/browser-model-chat/serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.artifacts/proof/model-chat');
const before = process.argv.includes('--before');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const profilePrefix = 'rag-memory-graph-ui-';
const checks = [], screenshots = [], forbiddenRequests = [], pageErrors = [];
const observations = [], ownedProfiles = [], priorAttempts = [];
const cleanup = { browserContextClosed: false, loopbackServerClosed: false, ownedTemporaryProfileRemoved: false };
const sourcePaths = ['examples/browser-model-chat/memory/panel.mjs', 'examples/browser-model-chat/memory/panel.css',
  'examples/browser-model-chat/memory/events.mjs', 'examples/browser-model-chat/memory/store.mjs',
  'examples/browser-model-chat/memory/rag-adapter.mjs', 'tests/model-chat-memory-graph-browser.mjs'];
const fixtureModule = `
import { mountApp } from './app.mjs';
import { createWorkspace } from './memory/workspace.mjs';
import { mountMemoryPanel } from './memory/panel.mjs';
import * as core from './memory/rag-core.mjs';
const fixture = window.__memoryGraphFixture = { label:'UI FIXTURE - real local stores/retrieval; no model loaded', calls:[],searches:[],searchActive:0,maxSearchActive:0 };
const adapter = {
 async prepare(){ fixture.calls.push('prepare'); throw Error('Model loading forbidden in graph UI fixture.'); },
 async measure(){ fixture.calls.push('measure'); throw Error('Native measurement forbidden in graph UI fixture.'); },
 async reply(){ fixture.calls.push('reply'); throw Error('Provider calls forbidden in graph UI fixture.'); },
 async dispose(){},
};
const workspace = await createWorkspace({ adapter, core, storage:localStorage });
const scope = {actorId:'local-user',conversationId:'local-chat'};
${before ? `for (const text of ['The harbor access code is CEDAR-731.', 'The delivery day is Thursday.', 'The preferred hot drink is ginger tea.']) {
 const turn=workspace.conversation.append({role:'user',content:text});await workspace.memory.save({text,sourceTurnIds:[turn.id],scope,modelSafe:true});
}` : `const shared=workspace.conversation.append({role:'user',content:'The harbor access code is CEDAR-731. The delivery day is Thursday.'});
for(const text of ['The harbor access code is CEDAR-731.','The delivery day is Thursday.'])await workspace.memory.save({text,sourceTurnIds:[shared.id],scope,modelSafe:true});
const drink=workspace.conversation.append({role:'user',content:'The preferred hot drink is ginger tea.'});
await workspace.memory.save({text:drink.content,sourceTurnIds:[drink.id],scope,modelSafe:true});
workspace.conversation.append({role:'user',content:'The harbor access code is MAPLE-946.'});`}
fixture.originalTurns=structuredClone(workspace.conversation.snapshot().turns);
const actualSearch=workspace.retrieval.search.bind(workspace.retrieval);
workspace.retrieval.search=async args=>{
 fixture.searches.push({query:args.query});fixture.searchActive++;fixture.maxSearchActive=Math.max(fixture.maxSearchActive,fixture.searchActive);
 try {await new Promise(accept=>setTimeout(accept,25));return await actualSearch(args);}finally{fixture.searchActive--;}
};
const app=mountApp(workspace.provider,{workspace});
// Explicit fixture presentation: reveal the existing panel entry without
// loading a model or claiming a ready/inference state.
document.getElementById('chat-options').hidden=false;
${before ? '' : `// Fixture presentation exposes the canonical transcript for real source-focus checks.
// The controller remains idle; no fake model load or ready/inference claim.
document.getElementById('loading-stage').hidden=true;document.getElementById('chat-stage').hidden=false;`}
const panel=mountMemoryPanel({...workspace,onChange:()=>workspace.persist(),rendererBackend:new URL(location.href).searchParams.get('backend')||'auto'});
workspace.attachPanel(panel);
const badge=document.createElement('p');badge.id='memory-graph-fixture-badge';badge.textContent=fixture.label;
badge.style.cssText='position:sticky;top:0;z-index:3;margin:0;padding:8px;background:#252014;color:#ffedc8;border-bottom:1px solid #e6c98e;font:11px/1.5 ui-monospace,monospace;pointer-events:none';
${before ? `panel.dialog.querySelector('.memory-panel-body').prepend(badge);` : `badge.textContent='UI FIXTURE - no model';badge.style.cssText='position:absolute;bottom:0;left:12px;z-index:4;margin:0;color:#ffedc8;font:8px/10px ui-monospace,monospace;pointer-events:none';
const header=panel.dialog.querySelector('.memory-panel-header');header.style.position='relative';header.append(badge);`}
window.localMemoryPreview={workspace,app};
fixture.addExtras=async()=>{for(let index=1;index<=8;index++){const text='Extra record '+index+': the archive shelf is copper '+index+'.';const turn=workspace.conversation.append({role:'user',content:text});await workspace.memory.save({text,sourceTurnIds:[turn.id],scope,modelSafe:true});}await workspace.persist();};
`;
let preview, context, profile, version, sourceIdentity, failure, workers = 0;
let retainedBefore, contextsOpened = 0, contextsClosed = 0;
const started = Date.now();
async function check(name, run) {
  const at = Date.now();
  try { await run(); checks.push({ name, status: 'pass', durationMs: Date.now() - at }); console.log('PASS memory graph UI: ' + name); }
  catch (error) { checks.push({ name, status: 'fail', durationMs: Date.now() - at, message: error.message }); throw error; }
}
const nodeSelector = id => `[data-memory-node="${id}"]`;
async function settled(page) { await page.evaluate(() => new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept)))); }
async function open(page) { if (!await page.locator('#memory-dialog').evaluate(dialog => dialog.open)) await page.locator('#memory-open').click(); }
async function graphReady(page, expected) {
  await page.waitForFunction(() => ['tsl','list','empty'].includes(document.getElementById('memory-graph').dataset.renderer), null, {timeout:20_000});
  const state=await page.locator('#memory-graph').evaluate(node=>({renderer:node.dataset.renderer,backend:node.dataset.backend||null}));
  if(expected)assert.equal(state.renderer,expected,JSON.stringify(state));return state;
}
async function search(page, query) {
  const completed=await page.evaluate(()=>window.__memoryGraphFixture.searches.length);
  await page.locator('#memory-query').fill(query);await page.locator('#memory-query').press('Enter');
  // Hardware-fallback status can supersede search copy. Actual retrieval
  // completion plus enabled input is the synchronization boundary; match IDs
  // below still assert the real result, never a fixture-supplied search answer.
  await page.waitForFunction(({completed,query})=>{const fixture=window.__memoryGraphFixture;return fixture.searches.length===completed+1&&fixture.searchActive===0&&fixture.searches.at(-1).query===query.trim()&&!document.getElementById('memory-query').disabled;},{completed,query});
  await settled(page);
}
async function matches(page) { return page.locator('[data-memory-node][data-matched="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.memoryNode).sort()); }
async function assertGeometry(page,name) {
  await settled(page);
  const value=await page.evaluate(()=>{
    const dialog=document.getElementById('memory-dialog'),body=dialog.querySelector('.memory-panel-body'),rect=dialog.getBoundingClientRect();
    const targets=[...dialog.querySelectorAll('button,a,input,select,textarea')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>{const box=node.getBoundingClientRect();return{label:node.id||node.dataset.memoryNode||node.textContent.trim(),memoryNode:Boolean(node.dataset.memoryNode),width:box.width,height:box.height,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};});
    const nodeTargets=[...dialog.querySelectorAll('[data-memory-node]')].filter(node=>node.getClientRects().length).map(node=>{const box=node.getBoundingClientRect(),cx=box.x+box.width/2,cy=box.y+box.height/2,owner=document.elementFromPoint(cx,cy)?.closest('[data-memory-node]');return{id:node.dataset.memoryNode,x:box.x,y:box.y,width:box.width,height:box.height,centerX:cx,centerY:cy,centerOwner:owner?.dataset.memoryNode||null,nodeX:node.style.getPropertyValue('--node-x'),nodeY:node.style.getPropertyValue('--node-y'),captionPointerEvents:getComputedStyle(node.querySelector('.memory-node-label')||node).pointerEvents};});
    return{viewport:{width:innerWidth,height:innerHeight},dialog:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom},documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,panelWidth:body.clientWidth,panelScrollWidth:body.scrollWidth,targets,nodeTargets,graphView:document.getElementById('memory-detail').hidden&&document.getElementById('memory-editor').hidden,reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,animations:document.getAnimations().filter(animation=>animation.playState==='running').length};
  });
  assert.ok(value.dialog.x>=-1&&value.dialog.y>=-1&&value.dialog.right<=value.viewport.width+1&&value.dialog.bottom<=value.viewport.height+1,name+' dialog fits');
  assert.ok(value.documentWidth<=value.viewport.width+1&&value.bodyWidth<=value.viewport.width+1,name+' document width');
  assert.ok(value.panelScrollWidth<=value.panelWidth+1,name+' panel width');
  for(const target of value.targets){assert.ok(target.width>=43.5&&target.height>=43.5,name+' target '+JSON.stringify(target));if(!target.memoryNode)assert.ok(target.scrollWidth<=target.clientWidth+1,name+' unclipped label '+JSON.stringify(target));}
  if(value.graphView)for(const target of value.nodeTargets){
    assert.equal(target.captionPointerEvents,'none',name+' caption must not steal hitbox');
    if(target.centerX>=0&&target.centerX<value.viewport.width&&target.centerY>=value.dialog.y+70&&target.centerY<value.dialog.bottom-5)assert.equal(target.centerOwner,target.id,name+' node center ownership '+JSON.stringify(value.nodeTargets));
  }
  assert.equal(value.reducedMotion,true);assert.equal(value.animations,0);
  observations.push({name,viewport:value.viewport,dialog:value.dialog,targets:value.targets.length,minimumTargetWidth:Math.min(...value.targets.map(target=>target.width)),minimumTargetHeight:Math.min(...value.targets.map(target=>target.height)),reducedMotion:true});
}

try {
  const dependency = process.env.BROWSER_MODEL_PLAYWRIGHT_MODULE;
  const chrome = process.env.MODEL_CHAT_BROWSER || process.env.BROWSER_RAG_CHROMIUM_PATH;
  if (!dependency || !chrome) throw Error('Set BROWSER_MODEL_PLAYWRIGHT_MODULE and MODEL_CHAT_BROWSER explicitly; no automatic install or browser download.');
  await access(dependency); await access(chrome);
  if(!before){
    const previous=await readFile(join(output,'memory-graph-result.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    retainedBefore=previous?.mode==='before'?{checks:previous.checks,screenshots:previous.screenshots,sourceIdentity:previous.sourceIdentity,cleanup:previous.cleanup}:previous?.before;
    priorAttempts.push(...(previous?.priorAttempts||[]).slice(previous?.status==='fail'?-2:-3));
    if(previous?.status==='fail')priorAttempts.push({status:'fail',failedCheck:previous.checks?.find(item=>item.status==='fail')?.name,
      passedChecks:previous.checks?.filter(item=>item.status==='pass').length,error:String(previous.error||'').replace(/\u001b\[[0-9;]*m/g,'').split('\n')[0],
      involvedNodeIds:[...new Set([...String(previous.error||'').matchAll(/data-memory-node="([^"]+)"/g)].map(match=>match[1]))].slice(0,4),
      lastGeometry:previous.observations?.findLast(item=>item.viewport),sourceIdentity:previous.sourceIdentity?.filter(item=>/\/panel\.(?:mjs|css)$/.test(item.path)),cleanup:previous.cleanup,boundary:previous.boundary});
    if(retainedBefore)screenshots.push(...retainedBefore.screenshots);
    sourcePaths.push('.artifacts/memory/graph-renderer.mjs');
    for(const name of await readdir(join(root,'examples/browser-model-chat/memory'))){const path='examples/browser-model-chat/memory/'+name;if(name.endsWith('.mjs')&&!sourcePaths.includes(path))sourcePaths.push(path);}
  }
  const corePath = join(root, '.artifacts/memory/rag-core.mjs');
  assert.equal(digest(await readFile(corePath)), 'c282ebb3965c4a25b48fb66082ce18c72184449f2123633a901ffceb9939ace6');
  if(!before)assert.equal(digest(await readFile(join(root,'.artifacts/memory/graph-renderer.mjs'))),'f0218f4a62109c67708a73d0068b6afb73d7857aa563b31c3a1363b9bf0cba6f');
  sourceIdentity = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
  const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
  profile = await mkdtemp(join(tmpdir(), profilePrefix));
  ownedProfiles.push(profile);
  preview = await startServer({ memoryCoreRoot: dirname(corePath),memoryGraphRoot:dirname(corePath) });
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless:true, chromiumSandbox:true, serviceWorkers:'block',
    ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings'] });
  contextsOpened++;context.setDefaultTimeout(8000); version = context.browser()?.version() || 'configured Chromium';
  async function fixturePage(query='?memory=1'){
    const value=await context.newPage();await value.setViewportSize({width:390,height:844});await value.emulateMedia({reducedMotion:'reduce'});
    value.on('worker',()=>workers++);value.on('pageerror',error=>pageErrors.push(error.message));
    await value.route('**/*',async route=>{const url=new URL(route.request().url());
      if(url.origin!==new URL(preview.url).origin||/\/runtime\/|engine-worker\.mjs|\.gguf$/i.test(url.pathname)){forbiddenRequests.push({origin:url.origin,path:url.pathname});await route.abort('blockedbyclient');return;}
      if(url.pathname==='/bootstrap.mjs'){await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:fixtureModule});return;}await route.continue();
    });
    await value.goto(preview.url+query,{waitUntil:'networkidle'});await value.waitForFunction(()=>window.localMemoryPreview?.workspace&&document.getElementById('memory-dialog'));return value;
  }
  let page=await fixturePage();
  if(before){
  await check('current dialog before screenshot uses real records and matching retrieval with a visible fixture label',async()=>{
    await page.locator('#memory-open').click();
    await page.locator('#memory-query').fill('harbor access code');await page.locator('#memory-recall').click();
    await page.waitForFunction(()=>document.querySelector('#memory-results .memory-record-text')?.textContent==='The harbor access code is CEDAR-731.');
    assert.equal(await page.locator('#memory-dialog').evaluate(dialog=>dialog.open),true);
    assert.equal(await page.locator('#memory-graph svg').count(),1);
    assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.memory.snapshot().records.length),3);
    await page.locator('#memory-recall-form').evaluate(node=>node.scrollIntoView({block:'start'}));
    await page.evaluate(()=>new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept))));
    assert.equal(await page.locator('#memory-graph-fixture-badge').isVisible(),true);
    await mkdir(output,{recursive:true});const target=join(output,'memory-graph-before.png');
    await page.screenshot({path:target,fullPage:false,animations:'disabled'});
    const bytes=await readFile(target);screenshots.push({path:'.artifacts/proof/model-chat/memory-graph-before.png',bytes:bytes.length,sha256:digest(bytes),evidence:'current dialog; labeled real-store/retrieval fixture, no model'});
  });
  }else{
    await check('actual TSL graph replaces dashboard sections with bounded native keyboard buttons',async()=>{
      await open(page);const state=await graphReady(page,'tsl');assert.ok(['webgpu','webgl2'].includes(state.backend));
      assert.equal(await page.locator('#memory-graph canvas:not([hidden])').count(),1);
      assert.equal(await page.locator('#memory-records,#memory-results,#memory-event-list,#memory-context-method,#memory-record').count(),0);
      assert.equal(await page.locator('[data-memory-kind="record"]').count(),3);assert.equal(await page.locator('[data-memory-kind="source"]').count(),2);
      assert.equal(await page.locator(nodeSelector('turn:t-0001')).count(),1,'two records share one actual authored source');
      for(const node of await page.locator('[data-memory-node]').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,label:node.getAttribute('aria-label')})))){assert.equal(node.tag,'BUTTON');assert.ok(node.label);}
      const sourceLabels=await page.locator('[data-memory-kind="source"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
      assert.equal(new Set(sourceLabels).size,sourceLabels.length,'canonical source labels are distinct for screen readers');
      assert.ok(sourceLabels.some(label=>label.includes('t-0001'))&&sourceLabels.some(label=>label.includes('t-0002')));
      assert.equal(await page.locator('#memory-graph canvas').getAttribute('data-motion-enabled'),'false');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='true');
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(()=>document.querySelector('#memory-graph canvas').dataset.motionEnabled==='false');
      observations.push({dynamicMotionPreference:[false,true,false],sourceAriaLabels:sourceLabels});
      observations.push({primaryRenderer:state,sharedSourceRecordIds:['m-0001','m-0002'],sharedSourceTurn:'t-0001'});
    });
    await check('submitted real retrieval lights only matching records and their actual sources',async()=>{
      await search(page,'harbor access code');assert.deepEqual(await matches(page),['record:m-0001','turn:t-0001']);
      assert.deepEqual(await page.evaluate(()=>window.__memoryGraphFixture.searches.map(call=>call.query)),['harbor access code']);
      assert.equal(await page.locator('#memory-query-clear').isVisible(),true);await assertGeometry(page,'390x844 matching');
      await page.locator(nodeSelector('record:m-0001')).focus();await settled(page);
      assert.equal(await page.locator(nodeSelector('record:m-0001')+' .memory-node-label').isVisible(),true,'focused matching caption is readable');
      await mkdir(output,{recursive:true});const path=join(output,'memory-graph-after.png');await page.screenshot({path,fullPage:false,animations:'disabled'});
      const bytes=await readFile(path);screenshots.push({path:'.artifacts/proof/model-chat/memory-graph-after.png',bytes:bytes.length,sha256:digest(bytes),evidence:'actual TSL renderer; real records/retrieval; labeled no-model UI fixture'});
    });
    await check('changed query, nonmatch and Clear remove stale match state; duplicate submits serialize',async()=>{
      await page.locator('#memory-query').fill('flying violet whale');assert.deepEqual(await matches(page),[]);
      assert.equal(await page.evaluate(()=>window.__memoryGraphFixture.searches.length),1,'typing does not fabricate retrieval');
      await page.locator('#memory-query').press('Enter');await page.waitForFunction(()=>document.getElementById('memory-status').textContent==='No matching saved memories.');assert.deepEqual(await matches(page),[]);
      await page.locator('#memory-query-clear').click();assert.equal(await page.locator('#memory-query').inputValue(),'');assert.deepEqual(await matches(page),[]);
      await page.locator('#memory-query').fill('ginger tea');
      await page.locator('#memory-recall-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
      await page.waitForFunction(()=>!document.getElementById('memory-query').disabled&&document.getElementById('memory-status').textContent==='Matching memories are lit up.');
      assert.deepEqual(await matches(page),['record:m-0003','turn:t-0002']);
      assert.equal(await page.evaluate(()=>window.__memoryGraphFixture.searches.length),3);assert.equal(await page.evaluate(()=>window.__memoryGraphFixture.maxSearchActive),1);
      await page.locator('#memory-query-clear').click();
      await settled(page);
      assert.equal(await page.locator('.memory-node-label:visible').count(),0,'idle graph suppresses overlapping captions');
      const idlePath=join(output,'memory-graph-idle.png');await page.screenshot({path:idlePath,fullPage:false,animations:'disabled'});
      const idleBytes=await readFile(idlePath);screenshots.push({path:'.artifacts/proof/model-chat/memory-graph-idle.png',bytes:idleBytes.length,sha256:digest(idleBytes),evidence:'actual idle TSL memory map; labeled real-store no-model fixture'});
    });
    await check('keyboard selection, Back, source focus and Escape preserve originals',async()=>{
      const original=await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState());
      await page.locator(nodeSelector('record:m-0001')).focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#memory-detail').isVisible(),true);assert.equal(await page.locator('#memory-detail-text').textContent(),'The harbor access code is CEDAR-731.');
      assert.equal(await page.locator(nodeSelector('record:m-0001')).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('[data-memory-node][aria-pressed="true"]').count(),1,'only selected node is exposed as pressed');
      assert.equal(await page.locator('#memory-detail-sources [data-memory-source="t-0001"]').getAttribute('href'),'#turn-t-0001');
      assert.equal(await page.locator('#memory-detail-title').evaluate(node=>document.activeElement===node),true);
      await page.locator('#memory-back').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-memory-node][aria-pressed="true"]').count(),0);
      assert.equal(await page.locator(nodeSelector('record:m-0001')).evaluate(node=>document.activeElement===node),true);
      await page.keyboard.press('Enter');await page.locator('#memory-detail-sources [data-memory-source="t-0001"]').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#memory-dialog').evaluate(dialog=>dialog.open),false);assert.equal(await page.locator('#turn-t-0001').evaluate(node=>document.activeElement===node),true);
      assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState()),original);
      await open(page);await graphReady(page,'tsl');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#memory-dialog').evaluate(dialog=>dialog.open),false);assert.equal(await page.locator('#memory-open').evaluate(node=>document.activeElement===node),true);
      await open(page);await graphReady(page,'tsl');
    });
    await check('context editors do not write until explicit correction; forgetting never rewrites originals',async()=>{
      const before=await page.evaluate(()=>({conversation:window.localMemoryPreview.workspace.conversation.exportState(),memory:window.localMemoryPreview.workspace.memory.exportState()}));
      await page.locator('#memory-add').click();assert.equal(await page.locator('#memory-editor').isVisible(),true);assert.equal(await page.locator('#memory-recall-form').isVisible(),false);
      await page.locator('#memory-cancel').click();assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.memory.exportState()),before.memory);
      await graphReady(page,'tsl');await page.locator(nodeSelector('record:m-0001')).click();await page.locator('#memory-edit').click();
      assert.equal(await page.locator('#memory-text').inputValue(),'The harbor access code is CEDAR-731.');assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.memory.exportState()),before.memory);
      await page.locator('#memory-source-turn').selectOption('t-0003');await page.locator('#memory-correct').click();
      await page.waitForFunction(()=>document.getElementById('memory-status').textContent==='Memory corrected.');
      assert.equal(await page.locator('#memory-detail-text').textContent(),'The harbor access code is MAPLE-946.');assert.equal(await page.locator('#memory-detail-sources [data-memory-source="t-0003"]').count(),1);
      await page.locator('#memory-forget').click();await page.waitForFunction(()=>document.getElementById('memory-status').textContent==='Memory forgotten.');
      assert.equal(await page.locator(nodeSelector('record:m-0001')).count(),0);await search(page,'harbor access code');assert.deepEqual(await matches(page),[]);
      assert.equal(await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.exportState()),before.conversation);
      assert.deepEqual(await page.evaluate(()=>window.localMemoryPreview.workspace.memory.snapshot().records.filter(item=>item.id==='m-0001').map(item=>[item.version,item.status])),[[1,'superseded'],[2,'superseded'],[3,'forgotten']]);
      await page.locator('#memory-query-clear').click();
    });
    await check('320px,390px,desktop and short views retain contained controls and reduced motion',async()=>{
      for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:960},{width:390,height:360}]){
        await page.setViewportSize(viewport);await settled(page);await assertGeometry(page,viewport.width+'x'+viewport.height);
        const button=page.locator('[data-memory-kind="record"]').first();await button.click();assert.equal(await page.locator('#memory-detail').isVisible(),true);
        await page.locator('#memory-edit').click();await assertGeometry(page,viewport.width+'x'+viewport.height+' editor');await page.locator('#memory-cancel').click();await graphReady(page,'tsl');
      }
      await page.setViewportSize({width:390,height:844});
    });
    await check('six-record twelve-node window can surface an older real hit without deleting saved records',async()=>{
      await page.evaluate(()=>window.__memoryGraphFixture.addExtras());await settled(page);
      assert.equal(await page.locator('[data-memory-kind="record"]').count(),6);assert.ok(await page.locator('[data-memory-node]').count()<=12);
      assert.equal(await page.evaluate(()=>{const workspace=window.localMemoryPreview.workspace;return workspace.memory.active({actorId:'local-user',conversationId:'local-chat'}).length;}),10);
      await search(page,'ginger tea');assert.deepEqual(await matches(page),['record:m-0003','turn:t-0002']);assert.equal(await page.locator('[data-memory-kind="record"]').count(),6);assert.ok(await page.locator('[data-memory-node]').count()<=12);
      assert.deepEqual(await page.evaluate(()=>window.localMemoryPreview.workspace.conversation.snapshot().turns.slice(0,3)),await page.evaluate(()=>window.__memoryGraphFixture.originalTurns));
    });
    await check('real WebGL2-unavailable browser keeps an honest accessible list fallback',async()=>{
      assert.deepEqual(await page.evaluate(()=>window.__memoryGraphFixture.calls),[]);await context.close();contextsClosed++;context=undefined;
      profile=await mkdtemp(join(tmpdir(),profilePrefix));ownedProfiles.push(profile);
      context=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,chromiumSandbox:true,serviceWorkers:'block',args:['--disable-webgl'],ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings']});contextsOpened++;context.setDefaultTimeout(8000);
      page=await fixturePage('?memory=1&backend=webgl2');await open(page);const state=await graphReady(page,'list');
      assert.equal(await page.evaluate(()=>document.createElement('canvas').getContext('webgl2')===null),true,'browser actually refuses WebGL2');
      assert.equal(await page.locator('#memory-graph canvas:not([hidden])').count(),0);assert.equal(await page.locator('[data-memory-kind="record"]').count(),3);
      assert.match(await page.locator('#memory-status').textContent(),/Graph unavailable/);await search(page,'harbor access code');assert.deepEqual(await matches(page),['record:m-0001','turn:t-0001']);
      await page.locator(nodeSelector('record:m-0001')).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#memory-detail-text').textContent(),'The harbor access code is CEDAR-731.');
      observations.push({unavailableRenderer:state,browserFlag:'--disable-webgl',actualWebGL2ContextRefused:true});
    });
  }
  await check('capture has no provider/native/Worker/external activity and source identities stayed fixed',async()=>{
    assert.deepEqual(await page.evaluate(()=>window.__memoryGraphFixture.calls),[]);assert.equal(workers,0);
    assert.deepEqual(forbiddenRequests,[]);assert.deepEqual(pageErrors,[]);
    for(const file of sourceIdentity)assert.equal(digest(await readFile(join(root,file.path))),file.sha256,file.path);
  });
} catch(error){failure=error;}
finally {
  try{if(context){await context.close();contextsClosed++;}cleanup.browserContextClosed=contextsClosed===contextsOpened;}catch(error){failure||=error;}
  try{if(preview){await preview.close();cleanup.loopbackServerClosed=true;}}catch(error){failure||=error;}
  try{for(const value of ownedProfiles){assert.equal(resolve(dirname(value)),resolve(tmpdir()));assert.ok(basename(value).startsWith(profilePrefix));await rm(value,{recursive:true,force:true});}cleanup.ownedTemporaryProfileRemoved=ownedProfiles.length>0;}catch(error){failure||=error;}
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'memory-graph-result.json'),JSON.stringify({schema:'rag-method.memory-graph-ui/v1',status:failure?'fail':'pass',mode:before?'before':'replacement',
    startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,node:process.version,browser:version,sourceIdentity,
    fixtureBootstrapSha256:digest(fixtureModule),checks,screenshots,observations,priorAttempts,...(retainedBefore?{before:retainedBefore}:{}),boundary:{fixture:true,providerCalls:0,actualNativeCalls:0,modelDownloads:0,workers,forbiddenRequests,pageErrors,contextsOpened,contextsClosed},cleanup,
    limitations:['Labeled real-store/retrieval UI fixture; no inference or native token proof.','Canonical transcript is exposed only for source-focus fixture checks; model controller stays idle.','Desktop-browser viewports are not physical mobile/iOS validation.'],...(failure?{error:failure.message}:{})},null,2)+'\n');
}
if(failure){console.error(failure.stack);process.exitCode=1;}
else console.log(`PASS ${checks.length} memory graph UI checks.`);
