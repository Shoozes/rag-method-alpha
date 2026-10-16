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
