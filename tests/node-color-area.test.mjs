import assert from 'node:assert/strict';
import test from 'node:test';
import {NODE_COLOR_THRESHOLDS as thresholds,measureNodeColorArea,assessNodeColorArea} from './node-color-area.mjs';

const samples=[{id:'c',scope:'conversation',x:10,y:12,radius:5},{id:'p',scope:'persona',x:27,y:12,radius:5},{id:'g',scope:'global',x:44,y:12,radius:5}];
const colors={conversation:[66,210,255],persona:[210,153,255],global:[250,206,59]};
async function fixture(painter){
  const width=55,height=25,rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb=[17,17,15];for(const sample of samples)rgb=painter(x,y,sample,rgb);
    const offset=(y*width+x)*4;rgba.set([...rgb,255],offset);
  }
  const measured=await measureNodeColorArea({rgba,width,height,samples,thresholds,viewport:{width,height}});
  return assessNodeColorArea(measured);
}
const inside=(x,y,sample)=>Math.hypot(x+.5-sample.x,y+.5-sample.y)<sample.radius;
test('broad sky blue violet amber body areas pass the frozen thresholds',async()=>{
  const result=await fixture((x,y,sample,rgb)=>inside(x,y,sample)?colors[sample.scope]:rgb);assert.equal(result.passed,true,JSON.stringify(result.failures));
});
test('a white body with one saturated colored pixel fails',async()=>{
  const result=await fixture((x,y,sample,rgb)=>inside(x,y,sample)?x===Math.floor(sample.x)&&y===Math.floor(sample.y)?colors[sample.scope]:[250,250,250]:rgb);
  assert.equal(result.passed,false);assert.ok(result.samples.every(sample=>sample.coloredFraction<.1));
});
test('colored text or halo outside the body region cannot qualify white nodes',async()=>{
  const result=await fixture((x,y,sample,rgb)=>inside(x,y,sample)?[250,250,250]:Math.hypot(x+.5-sample.x,y+.5-sample.y)<sample.radius+2||y>20?colors[sample.scope]:rgb);
  assert.equal(result.passed,false);assert.ok(result.samples.every(sample=>sample.coloredFraction===0));
});
test('equal saturated body colors fail intended scope hues and separation',async()=>{
  const result=await fixture((x,y,sample,rgb)=>inside(x,y,sample)?colors.conversation:rgb);assert.equal(result.passed,false);assert.ok(result.pairs.every(pair=>pair.distance===0));
});
test('published washed-out scope averages fail despite their positive tint',async()=>{
  const washed={conversation:[207,216,220],persona:[255,231,255],global:[249,231,197]};
  const result=await fixture((x,y,sample,rgb)=>inside(x,y,sample)?washed[sample.scope]:rgb);assert.equal(result.passed,false);assert.ok(result.samples.every(sample=>sample.coloredFraction===0));
});

const overlapping=[{id:'back',scope:'conversation',x:23,y:25,radius:15,depth:100},
  {id:'front',scope:'persona',x:30,y:25,radius:12,depth:50},
  {id:'aside',scope:'global',x:57,y:25,radius:6,depth:75}];
const mask=nodes=>({kind:'projected-depth-disks-v1',nodes:nodes.map(({id,x,y,radius,depth})=>({id,x,y,radius,depth}))});
async function overlapFixture({nodes=overlapping,colorById={},occlusion=mask(nodes),scale=1}={}){
  const width=70*scale,height=50*scale,rgba=new Uint8ClampedArray(width*height*4);
  const ordered=nodes.slice().sort((a,b)=>b.depth-a.depth);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb=[17,17,15];
    for(const node of ordered)if(Math.hypot((x+.5)/scale-node.x,(y+.5)/scale-node.y)<node.radius)rgb=colorById[node.id]||colors[node.scope];
    rgba.set([...rgb,255],(y*width+x)*4);
  }
  const measured=await measureNodeColorArea({rgba,width,height,samples:nodes,thresholds,viewport:{width:70,height:50},occlusion});
  return{measured,result:assessNodeColorArea(measured)};
}

test('depth geometry retains visible blue crescent and actual foreground persona independently of DOM center ownership',async()=>{
  const {measured,result}=await overlapFixture();assert.equal(result.passed,true,JSON.stringify(result.failures));
  const back=measured.find(row=>row.id==='back'),front=measured.find(row=>row.id==='front');
  assert.ok(back.occludedSamples>0&&back.samples>=thresholds.minimumSamples);assert.equal(back.coloredFraction,1);
  assert.equal(front.occludedSamples,0);assert.equal(front.coloredFraction,1);
  assert.equal(back.bodySamples,back.samples+back.occludedSamples);
});

test('a foreground blue sphere cannot qualify a white blue-scope body behind it',async()=>{
  const {measured,result}=await overlapFixture({colorById:{back:[250,250,250],front:colors.conversation}});
  const back=measured.find(row=>row.id==='back');assert.ok(back.samples>=12&&back.occludedSamples>0);assert.equal(back.coloredFraction,0);
  assert.equal(result.passed,false);assert.ok(result.failures.some(value=>value.startsWith('back: intended-hue')));
});

test('a genuinely wrong unoccluded body still fails despite a correctly colored foreground sphere',async()=>{
  const {measured,result}=await overlapFixture({colorById:{back:[245,45,45]}});
  assert.equal(measured.find(row=>row.id==='back').coloredFraction,0);assert.equal(result.passed,false);
  assert.ok(result.failures.some(value=>value.startsWith('back: intended-hue')));
});

test('occlusion sampling count depends only on geometry and uses the same CSS mask at doubled pixel scale',async()=>{
  const ordinary=await overlapFixture(),wrong=await overlapFixture({colorById:{back:[250,250,250],front:[245,45,45]}}),double=await overlapFixture({scale:2});
  assert.deepEqual(ordinary.measured.map(({samples,occludedSamples})=>({samples,occludedSamples})),wrong.measured.map(({samples,occludedSamples})=>({samples,occludedSamples})));
  assert.equal(double.result.passed,true,JSON.stringify(double.result.failures));
  assert.ok(double.measured.every(row=>row.samples>=12));
});

test('fully occluded or depth-tied ambiguous bodies cannot pass the minimum visible-pixel boundary',async()=>{
  for(const depth of [50,100]){
    const nodes=overlapping.map(node=>node.id==='front'?{...node,x:23,y:25,radius:18,depth}:node);
    const {measured,result}=await overlapFixture({nodes});
    assert.equal(measured.find(row=>row.id==='back').samples,0);assert.equal(result.passed,false);
    assert.ok(result.failures.some(value=>value==='back: too few body samples'));
  }
});

test('unknown, malformed or ambiguous occlusion masks fail closed',async()=>{
  const ordinary=mask(overlapping);
  const invalid=[null,[],{}, {...ordinary,kind:'color-selected-roi'}, {...ordinary,padding:100}, {...ordinary,nodes:null},
    {...ordinary,nodes:[...ordinary.nodes,ordinary.nodes[0]]}, {...ordinary,nodes:ordinary.nodes.map((node,index)=>index?node:{...node,radius:NaN})},
    {...ordinary,nodes:ordinary.nodes.map((node,index)=>index?node:{...node,depth:0})},
    {...ordinary,nodes:ordinary.nodes.map((node,index)=>index?node:{...node,x:Infinity})}];
  for(const occlusion of invalid)await assert.rejects(overlapFixture({occlusion}),/occlusion geometry/);
});

test('sample identity and projection must exactly match the supplied geometry mask',async()=>{
  for(const occlusion of [mask(overlapping.slice(1)),mask(overlapping.map(node=>node.id==='back'?{...node,x:node.x+1}:node)),mask(overlapping.map(node=>node.id==='back'?{...node,depth:node.depth+1}:node))]){
    await assert.rejects(overlapFixture({occlusion}),/exact projected mask identity/);
  }
});

test('required scope presence and frozen hue, saturation, area and twelve-pixel thresholds remain mandatory',async()=>{
  const {measured}=await overlapFixture();
  const missing=assessNodeColorArea(measured.filter(row=>row.scope!=='persona'));
  assert.ok(missing.failures.includes('No actual body sample for persona'));
  assert.equal(thresholds.minimumSamples,12);assert.equal(thresholds.minimumColoredFraction,.65);
  assert.equal(thresholds.minimumSaturation,.35);assert.equal(thresholds.minimumMeanSaturation,.35);
  assert.deepEqual(thresholds.hues,{conversation:[185,220],persona:[255,300],global:[30,55]});
});
