export interface SpawnOptions { from?:number;to?:number;durationMs?:number;delayMs?:number;overshoot?:number;peak?:number; }
export interface NodeSpawnMotion {
 animate(id:string,options?:SpawnOptions):boolean;
 pulse(id:string,options?:SpawnOptions):boolean;
 cancel(id:string,settle?:boolean):boolean;
 cancelAll(settle?:boolean):void;
 set(id:string,scale:number):boolean;
 setMany(entries:Iterable<readonly [string,number]>):readonly string[];
 remove(id:string):void;
 scale(id:string):number;
 readonly activeCount:number;
 dispose():void;
}
export function createNodeSpawnMotion(options:{
 refreshNodeStyles:(ids:readonly string[])=>void;
 reducedMotion?:()=>boolean;
 onError?:(error:unknown)=>void;
 requestFrame?:(callback:FrameRequestCallback)=>number;
 cancelFrame?:(id:number)=>void;
 now?:()=>number;
}):NodeSpawnMotion;
