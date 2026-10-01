import type { PositionedGraph } from "../application/layoutGraph.js";
import type { RagGraphRenderer } from "../application/graphRenderer.js";

const SVG = "http://www.w3.org/2000/svg";
type Point = Readonly<{ x:number; y:number; visible:boolean }>;
export interface CinematicGraphOptions {
 surface:HTMLElement; svg:SVGSVGElement; canvas:HTMLCanvasElement;
 renderer:()=>RagGraphRenderer|null; motionEnabled:()=>boolean; isDemo:()=>boolean;
}
/** Replays accepted graph state; it never drives indexing, ranking, or context. */
export class CinematicGraphPresentation {
 private graph:PositionedGraph|null=null;
 private selected:string|null=null;
 private hits=new Set<string>();
 private frame=0;
 private flowToken="";
 private animations:Animation[]=[];
 private beamAnimations:Animation[]=[];
 private generation=0;
 private readonly layer:SVGSVGElement;
 private readonly labels:HTMLDivElement;
 private readonly metrics:HTMLDivElement;
 private readonly refresh=()=>this.schedule();
 constructor(private readonly options:CinematicGraphOptions) {
  this.layer=document.createElementNS(SVG,"svg");this.layer.classList.add("cinematic-layer");this.layer.setAttribute("aria-hidden","true");
  this.labels=document.createElement("div");this.labels.className="atlas-labels";this.labels.setAttribute("aria-hidden","true");
  this.metrics=document.createElement("div");this.metrics.className="atlas-metrics";
  options.surface.append(this.layer,this.labels,this.metrics);
  options.canvas.addEventListener("pointerup",this.refresh);
  options.canvas.addEventListener("rag-camera-frame",this.refresh);
  options.canvas.addEventListener("wheel",this.refresh,{passive:true});
  window.addEventListener("resize",this.refresh);
 }
 setGraph(graph:PositionedGraph):void {
  this.graph=graph;this.flowToken="";this.schedule();
  const notes=graph.nodes.filter(node=>node.kind==="source").length;
  this.metrics.textContent=`${this.options.isDemo()?"Demo vault · ":""}${notes} visible notes · ${graph.links.length} connections${graph.clipped?" · bounded view":""}`;
 }
 setSelection(selected:string|null,hits:readonly string[]):void {
  this.selected=selected;this.hits=new Set(hits);this.schedule();
 }
 stop():void {this.generation++;for(const animation of [...this.animations,...this.beamAnimations])animation.cancel();this.animations=[];this.beamAnimations=[];delete this.options.surface.dataset.buildActive;}
 replayBuild():void {
  this.stop();if(!this.options.motionEnabled()||!this.graph)return;
  const generation=this.generation;
  this.options.surface.dataset.buildActive="true";
  const circles=[...this.options.svg.querySelectorAll<SVGCircleElement>("circle[data-graph-node-id]")];
  const selected=circles.slice(0,320);
  for(const [index,circle]of selected.entries()){
   const animation=circle.animate([{opacity:0,transform:"scale(.08)"},{opacity:1,transform:"scale(1.1)",offset:.72},{opacity:1,transform:"scale(1)"}],{duration:700,delay:Math.min(1100,index*3.5),easing:"cubic-bezier(.18,.78,.24,1)",fill:"backwards"});
   circle.style.transformBox="fill-box";circle.style.transformOrigin="center";this.animations.push(animation);
  }
  Promise.allSettled(this.animations.map(animation=>animation.finished)).then(()=>{if(generation===this.generation)delete this.options.surface.dataset.buildActive;});
 }
 private schedule():void {
  if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});
 }
 private points():Map<string,Point> {
  if(this.options.surface.dataset.renderer==="tsl"){
   const targets=JSON.parse(this.options.canvas.dataset.nodeTargets??"[]") as readonly {node_id:string;x:number;y:number;visible:boolean}[];
   return new Map(targets.map(point=>[point.node_id,point]));
  }
  const bounds=this.options.surface.getBoundingClientRect();
  return new Map([...this.options.svg.querySelectorAll<SVGCircleElement>("circle[data-graph-node-id]")].map(circle=>{
   const box=circle.getBoundingClientRect();const x=box.x+box.width/2-bounds.x;const y=box.y+box.height/2-bounds.y;
   return [circle.dataset.graphNodeId!,{x,y,visible:x>=0&&y>=0&&x<=bounds.width&&y<=bounds.height}];
  }));
 }
 private draw():void {
  if(!this.graph)return;
  this.labels.replaceChildren();
  const {width,height}=this.options.surface.getBoundingClientRect();this.layer.setAttribute("viewBox",`0 0 ${width} ${height}`);
  const points=this.points();
  const labelPriority=(id:string)=>id===this.selected?3:this.hits.has(id)?2:1;
  const labelLimit=width<=720?12:18;
  const occupied:DOMRect[]=[];
  const surfaceBounds=this.options.surface.getBoundingClientRect();
  const labelNodes=this.graph.nodes.filter(node=>node.id===this.selected||this.hits.has(node.id)||node.kind==="folder").sort((a,b)=>labelPriority(b.id)-labelPriority(a.id)).slice(0,54);
  for(const node of labelNodes){
   if(this.labels.childElementCount>=labelLimit)break;
   const point=points.get(node.id);if(!point?.visible)continue;
   const label=document.createElement("span");label.className="atlas-label";label.textContent=node.label;label.style.left=point.x+"px";label.style.top=point.y+"px";label.dataset.selected=String(node.id===this.selected);this.labels.append(label);
   const initial=label.getBoundingClientRect();
   label.style.left=Math.max(initial.width/2+6,Math.min(width-initial.width/2-6,point.x))+"px";
   label.style.top=Math.max(initial.height*1.3+6,Math.min(height-6,point.y))+"px";
   const box=label.getBoundingClientRect();
   const overlaps=occupied.some(other=>box.left<other.right+6&&box.right>other.left-6&&box.top<other.bottom+6&&box.bottom>other.top-6);
   if(overlaps||box.left<surfaceBounds.left||box.right>surfaceBounds.right){label.remove();continue;}
   occupied.push(box);
  }
  const token=JSON.stringify([this.selected,[...this.hits],this.options.motionEnabled()]);
  if(token===this.flowToken){
   for(const line of this.layer.querySelectorAll<SVGPathElement>("path[data-source-node-id]")){const from=points.get(line.dataset.sourceNodeId!),to=points.get(line.dataset.targetNodeId!);if(from&&to)line.setAttribute("d",`M ${from.x} ${from.y} L ${to.x} ${to.y}`);}
   for(const halo of this.layer.querySelectorAll<SVGCircleElement>("[data-node-id]")){const point=points.get(halo.dataset.nodeId!);if(point){halo.setAttribute("cx",String(point.x));halo.setAttribute("cy",String(point.y));}}
   return;
  }
  this.flowToken=token;for(const animation of this.beamAnimations)animation.cancel();this.beamAnimations=[];this.layer.replaceChildren();
  const links=this.graph.links.filter(link=>this.hits.has(link.source)||this.hits.has(link.target)).slice(0,24);
  for(const [index,link]of links.entries()){
   const from=points.get(link.source),to=points.get(link.target);if(!from?.visible||!to?.visible)continue;
   const create=(className:string)=>{
    const line=document.createElementNS(SVG,"path");line.setAttribute("d",`M ${from.x} ${from.y} L ${to.x} ${to.y}`);line.setAttribute("pathLength","100");line.classList.add(className);line.dataset.sourceNodeId=link.source;line.dataset.targetNodeId=link.target;this.layer.append(line);return line;
   };
   create("evidence-connection");
   if(this.options.motionEnabled()){
    const beam=create("light-travel");const animation=beam.animate([{strokeDashoffset:"100",opacity:0},{opacity:.95,offset:.18},{strokeDashoffset:"-100",opacity:0}],{duration:1300,delay:index*35,iterations:1,easing:"ease-in-out"});
    this.beamAnimations.push(animation);animation.finished.finally(()=>{beam.remove();this.beamAnimations=this.beamAnimations.filter(value=>value!==animation);}).catch(()=>{});
   }
  }
  for(const id of this.hits){
   const point=points.get(id);if(!point?.visible)continue;
   const halo=document.createElementNS(SVG,"circle");halo.setAttribute("cx",String(point.x));halo.setAttribute("cy",String(point.y));halo.setAttribute("r","9");halo.classList.add("arrival-halo");halo.dataset.nodeId=id;this.layer.append(halo);
  }
 }
 clear():void {
  this.stop();this.graph=null;this.selected=null;this.hits.clear();this.layer.replaceChildren();this.labels.replaceChildren();this.metrics.textContent="";
 }
 dispose():void {
  this.clear();if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;
  this.options.canvas.removeEventListener("pointerup",this.refresh);this.options.canvas.removeEventListener("rag-camera-frame",this.refresh);this.options.canvas.removeEventListener("wheel",this.refresh);window.removeEventListener("resize",this.refresh);
  this.layer.remove();this.labels.remove();this.metrics.remove();
 }
}
