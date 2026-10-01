import test from 'node:test';import assert from 'node:assert/strict';
import {createNodeSpawnMotion} from '../../src/presentation/nodeSpawnMotion.js';
function harness(reduced=false){
 let now=0,sequence=0;const frames=new Map(),refreshes=[];
 const motion=createNodeSpawnMotion({refreshNodeStyles:ids=>refreshes.push([...ids]),now:()=>now,reducedMotion:()=>reduced,requestFrame:callback=>{const id=++sequence;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id)});
 const tick=time=>{now=time;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(time);};
 return{motion,frames,refreshes,tick};
}
test('many data arrivals share one animation frame and one batched refresh per tick',()=>{
 const h=harness();for(let i=0;i<80;i++)h.motion.animate('note-'+i,{durationMs:600});
 assert.equal(h.frames.size,1);h.refreshes.length=0;h.tick(300);
 assert.equal(h.refreshes.length,1);assert.equal(h.refreshes[0].length,80);
 assert.equal(h.frames.size,1);h.tick(600);assert.equal(h.motion.activeCount,0);assert.equal(h.frames.size,0);
 h.motion.dispose();
});
test('repeated replays discard interrupted transient scale and pending frames',()=>{
 const h=harness();h.motion.animate('source',{durationMs:800});h.tick(100);h.motion.cancelAll(false);
 assert.equal(h.frames.size,0);assert.equal(h.motion.activeCount,0);assert.equal(h.motion.scale('source'),1);
 h.motion.animate('source',{from:.08,durationMs:500});h.tick(600);assert.equal(h.motion.scale('source'),1);assert.equal(h.frames.size,0);h.motion.dispose();
});
test('reduced motion settles immediately with no scheduler',()=>{
 const h=harness(true);assert.equal(h.motion.animate('source',{from:.08,to:1}),false);assert.equal(h.motion.scale('source'),1);
 assert.equal(h.motion.pulse('source',{peak:1.7}),false);assert.equal(h.frames.size,0);assert.equal(h.motion.activeCount,0);h.motion.dispose();
});
test('arrival highlights can be cancelled without altering persistent graph data',()=>{
 const h=harness();const source=Object.freeze({id:'note',score:350000,path:'manual/texture.md'});
 h.motion.pulse(source.id,{peak:1.7,durationMs:700});h.tick(200);assert.ok(h.motion.scale(source.id)>1);
 h.motion.cancel(source.id);assert.equal(h.motion.scale(source.id),1);assert.deepEqual(source,{id:'note',score:350000,path:'manual/texture.md'});h.motion.dispose();
});
test('disposed motion releases frames and refuses later replay',()=>{
 const h=harness();h.motion.animate('source');assert.equal(h.frames.size,1);h.motion.dispose();
 assert.equal(h.frames.size,0);assert.equal(h.motion.activeCount,0);assert.throws(()=>h.motion.animate('source'),/disposed/);
});
