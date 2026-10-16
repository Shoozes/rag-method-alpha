import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { createForceGraph3D, createThreePlatform, NodeFlags } from "@ours/forcegraph-tsl";
import { createNodeSpawnMotion } from "../presentation/nodeSpawnMotion.js";
import { sampleCameraPoseTween } from "@ours/forcegraph-tsl/camera";
import { planPerspectiveCameraFrame } from "@ours/forcegraph-tsl/camera";
import type { CameraPose, ForceGraph, RendererBackend } from "@ours/forcegraph-tsl";
import type { PositionedGraph, PositionedGraphNode } from "./layoutGraph.js";
import { graphColorNumber, graphFamilyColorNumber } from "./graphPalette.js";

export type RagRendererMode = "tsl" | "svg";
export type RagRendererBackend = "auto" | "webgl2";

interface RenderNodeData {
  readonly kind: PositionedGraphNode["kind"];
  readonly record_id: string | null;
  readonly source_id: string | null;
  readonly path: string;
}

export interface RagGraphRenderer {
  readonly mode: RagRendererMode;
  readonly backend: "webgpu" | "webgl2" | "none";
  render(graph: PositionedGraph): void;
  refreshViewport(): void;
  setMotionEnabled(enabled:boolean):void;
  replaySpawn():void;
  stopMotion():void;
  fit(): void;
  getCameraPose(): CameraPose | null;
  setCameraPose(pose: CameraPose): void;
  setInteractionState(selectedNodeId: string | null, hitNodeIds: readonly string[]): void;
  diagnostics(): RagGraphRendererDiagnostics;
  clear(): void;
  dispose(): void;
}

export interface RagGraphRendererDiagnostics {
  readonly runtime: RagGraphRuntimeDiagnostics;
  readonly selected_node_id: string | null;
  readonly hit_node_ids: readonly string[];
  readonly hit_targets: readonly RagGraphHitTarget[];
  readonly node_targets: readonly RagGraphNodeTarget[];
  readonly viewport: RagGraphViewportDiagnostics;
  readonly camera_pose: CameraPose | null;
  readonly node_colors: readonly { readonly node_id: string; readonly base_color: number }[];
}

export interface RagGraphRuntimeDiagnostics {
  readonly requested_backend: RagRendererBackend;
  readonly selected_backend: "webgpu" | "webgl2" | "none";
  readonly device_pixel_ratio: number;
  readonly graph_revision: number;
  readonly topology_revision: number;
  readonly camera_revision: number;
  readonly picking_revision: number;
  readonly picking_mode: "raycast" | "spatial" | "gpu-id" | "none";
}

export interface RagGraphHitTarget {
  readonly node_id: string;
  readonly x: number;
  readonly y: number;
}

export interface RagGraphNodeTarget extends RagGraphHitTarget {
  readonly visible: boolean;
}

export interface RagGraphViewportDiagnostics {
  readonly width: number;
  readonly height: number;
  readonly automatic_frame_count: number;
  readonly update_count: number;
  readonly frame_pending: boolean;
  readonly user_adjusted: boolean;
  readonly lifecycle: "waiting" | "ready" | "disposed";
}

export interface CreateRagGraphRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly backend?: RagRendererBackend;
  readonly nodeColor?: (nodeId: string) => number | undefined;
  readonly preserveNodeColors?: boolean;
  /** Flat scope colors for memory maps; other consumers retain the metallic surface. */
  readonly nodeSurface?: "default" | "scope-colored";
  readonly onNodeActivate: (nodeId: string) => void;
  readonly onTerminalFailure: (message: string) => void;
}

function nodeRadius(node: { readonly data?: RenderNodeData }): number {
  return node.data?.kind === "source" ? 3.8 : node.data?.kind === "folder" ? 6.5 : 1.9;
}

function nodeColor(node: { readonly data?: RenderNodeData }): number {
  return node.data ? graphFamilyColorNumber(node.data.path) : graphColorNumber("chunk");
}

function copyCameraPose(pose: CameraPose): CameraPose {
  const copy = {
    position: { x: pose?.position?.x, y: pose?.position?.y, z: pose?.position?.z },
    target: { x: pose?.target?.x, y: pose?.target?.y, z: pose?.target?.z },
  };
  const coordinates = [...Object.values(copy.position), ...Object.values(copy.target)];
  const distance = Math.hypot(copy.position.x - copy.target.x, copy.position.y - copy.target.y, copy.position.z - copy.target.z);
  if (coordinates.some(value => !Number.isFinite(value)) || distance < 0.1 || distance > 100_000) {
    throw new Error("Camera pose requires finite coordinates and a distance from 0.1 to 100000.");
  }
  return copy;
}

function frameVisibleGraph(
  graph: ForceGraph<RenderNodeData, { readonly kind: string }>,
  canvas: HTMLCanvasElement,
): CameraPose | null {
  const bounds = graph.getGraphBounds();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!bounds || width <= 0 || height <= 0) return null;
  const nodeMargin = 18;
  const frame = planPerspectiveCameraFrame({
    min: { x: bounds.min.x - nodeMargin, y: bounds.min.y - nodeMargin, z: bounds.min.z - nodeMargin },
    max: { x: bounds.max.x + nodeMargin, y: bounds.max.y + nodeMargin, z: bounds.max.z + nodeMargin },
  }, {
    aspect: width / height,
    verticalFovDegrees: 50,
    padding: 1.16,
    minimumDistance: 24,
  });
  graph.setCameraPose(frame);
  return frame;
}

export async function createTslRagGraphRenderer(options: CreateRagGraphRendererOptions): Promise<RagGraphRenderer> {
  const scopeColoredSurface = options.nodeSurface === "scope-colored";
  const baseColors = new Map<string, number>();
  const resolvedNodeColor = (node: { readonly id: string | number; readonly data?: RenderNodeData }): number => {
    const id = String(node.id), supplied = options.nodeColor?.(id);
    if (supplied !== undefined && (!Number.isInteger(supplied) || supplied < 0 || supplied > 0xffffff)) {
      throw new Error("Graph node color must be an RGB integer from 0 to 0xffffff.");
    }
    const color = supplied ?? nodeColor(node);
    baseColors.set(id, color);
    return color;
  };
  let graph: ForceGraph<RenderNodeData, { readonly kind: string }> | null = await createForceGraph3D<RenderNodeData, { readonly kind: string }>({
    platform: createThreePlatform({ THREE, TSL }),
    host: { mode: "managed", canvas: options.canvas },
    renderer: {
      backend: (options.backend ?? "auto") as RendererBackend,
      frameLoop: "demand",
      linkWidthUnit: "pixel",
      pixelRatio: { minimum: 1, maximum: 2 },
      nodeSurface: {
        profile: scopeColoredSurface ? "flat" : "metallic",
        metalness: 0.88,
        roughness: 0.2,
        emissive: 0.62,
        selectionEffect: { enabled: true, bubbleScale: 2.1, intensity: scopeColoredSurface ? 0.12 : 0.9, color: options.preserveNodeColors ? 0xffffff : graphColorNumber("selected"), breathAmount: 0 },
      },
      linkFlow: {
        enabled: false,
        direction: "source-to-target",
        speed: 0.72,
        frequency: 1.8,
        pulseWidth: 0.14,
        intensity: 0.78,
        color: graphColorNumber("selected"),
        nodeReaction: { enabled: true, scale: 1.2, intensity: 0.58, color: graphColorNumber("selected") },
      },
      cameraPose: { position: { x: 0, y: 0, z: 120 }, target: { x: 0, y: 0, z: 0 } },
    },
    layout: { backend: "local", autoStart: false, dimensions: 2, seed: 20260919 },
    nodes: { radius: nodeRadius, color: resolvedNodeColor },
    links: {
      width: (link) => link.data?.kind === "reference" ? 1.6 : 1.05,
      color: (link) => link.data?.kind === "reference" ? graphColorNumber("reference") : graphColorNumber("link"),
      opacity: 0.56,
    },
    interaction: { hover: true, dragNodes: false, selection: "single", navigation: true },
    stateTheme: {
      selected: { color: graphColorNumber("selected"), colorMix: options.preserveNodeColors ? 0 : 0.98, scale: 1.42 },
      focused: { color: graphColorNumber("hit"), colorMix: options.preserveNodeColors ? 0 : 0.82, scale: 1.2 },
      ...(scopeColoredSurface ? { hovered: { colorMix: 0 } } : {}),
    },
  });

  const startup = graph.getStartupReport();
  const offClick = graph.on("node-click", (event) => options.onNodeActivate(String(event.nodeId)));
  const offLoss = graph.on("device-lost", (event) => {
    options.onTerminalFailure(event.api + " device lost: " + event.message);
  });
  const offError = graph.on("error", (event) => options.onTerminalFailure(event.error.message));
  let selectedNodeId: string | null = null;
  let hitNodeIds = new Set<string>();
  let visibleNodeIds: readonly string[] = [];
  let hasGraphData = false;
  let framePending = false;
  let userAdjusted = false;
  let automaticFrameCount = 0;
  let viewportUpdateCount = 0;
  let lastViewport: Readonly<{ width: number; height: number }> | null = null;
  let scheduledViewportFrame = 0;
  let viewportLifecycle: RagGraphViewportDiagnostics["lifecycle"] = "waiting";
  let graphRevision = 0;
  let motionEnabled = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let unitsPerPixel = 0;
  let cameraFrame = 0;
  let motionStyleFrame = 0;
  const dirtyMotionIds = new Set<string>();
  const stopCamera = ():void => { if(cameraFrame)cancelAnimationFrame(cameraFrame);cameraFrame=0; };
  const nodeMotion = createNodeSpawnMotion({
    reducedMotion:()=>!motionEnabled,
    refreshNodeStyles:(ids)=>{ for(const id of ids)dirtyMotionIds.add(id);if(!motionStyleFrame)motionStyleFrame=requestAnimationFrame(()=>{motionStyleFrame=0;if(graph){graph.refreshNodeStyles(dirtyMotionIds);graph.render();options.canvas.dataset.spawnActive=String(nodeMotion.activeCount);}dirtyMotionIds.clear();}); },
    onError:(error)=>options.onTerminalFailure(error instanceof Error?error.message:String(error)),
  });
  const styledRadius = (node:{readonly id:string|number;readonly data?:RenderNodeData}):number => Math.max(nodeRadius(node),unitsPerPixel*(node.data?.kind==="folder"?2.8:node.data?.kind==="source"?1.8:1))*nodeMotion.scale(String(node.id));
  const fly = (from:CameraPose,to:CameraPose,durationMs:number):void => {
    stopCamera();if(!graph||!motionEnabled||userAdjusted)return;let start:number|null=null;
    const tick=(time:number):void=>{cameraFrame=0;if(!graph)return;start??=time;const pose=sampleCameraPoseTween({from,to,durationMs,easing:"cubic-in-out",path:{type:"direct"}},Math.max(0,time-start));graph.setCameraPose(pose);graph.render();publishDiagnostics();if(!pose.complete)cameraFrame=requestAnimationFrame(tick);};cameraFrame=requestAnimationFrame(tick);
  };
  const spawn = (ids:readonly string[]):void => {
    if(!graph||!motionEnabled)return;const selected=ids.slice(0,320);nodeMotion.setMany(selected.map(id=>[id,.08] as const));for(const [index,id]of selected.entries())nodeMotion.animate(id,{from:.08,durationMs:680,delayMs:Math.min(1050,index*3.4),overshoot:1.1});
  };

  const viewport = (): Readonly<{ width: number; height: number }> | null => {
    const width = options.canvas.clientWidth;
    const height = options.canvas.clientHeight;
    return width > 0 && height > 0 ? { width, height } : null;
  };

  const currentCameraPose = (): CameraPose | null => {
    const pose = graph?.getCameraPose();
    return pose ? { position: { ...pose.position }, target: { ...pose.target } } : null;
  };

  const updateNodeScale = (height: number): void => {
    if (!graph) return;
    const pose = graph.getCameraPose();
    if (!pose) return;
    const distance = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
    unitsPerPixel = 2 * distance * Math.tan(25 * Math.PI / 180) / height;
    graph.setNodeStyle({ radius: styledRadius, color: resolvedNodeColor });
  };

  const projectedTargets = (nodeIds: Iterable<string>): readonly RagGraphNodeTarget[] => {
    const measured = viewport();
    if (!graph || !measured) return [];
    const pose = graph.getCameraPose();
    if (!pose) return [];
    const camera = new THREE.PerspectiveCamera(50, measured.width / measured.height, 0.1, 100_000);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return [...nodeIds].flatMap((nodeId) => {
      const position = graph?.getNodePosition(nodeId);
      if (!position) return [];
      const projected = new THREE.Vector3(position.x, position.y, position.z).project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      return [{
        node_id: nodeId,
        x: ((projected.x + 1) / 2) * measured.width,
        y: ((1 - projected.y) / 2) * measured.height,
        visible,
      }];
    });
  };

  const hitTargets = (): readonly RagGraphHitTarget[] => {
    return projectedTargets(hitNodeIds).filter((target) => target.visible).map(({ node_id, x, y }) => ({ node_id, x, y }));
  };

  const viewportDiagnostics = (): RagGraphViewportDiagnostics => {
    const measured = viewport();
    return Object.freeze({
      width: measured?.width ?? 0,
      height: measured?.height ?? 0,
      automatic_frame_count: automaticFrameCount,
      update_count: viewportUpdateCount,
      frame_pending: framePending,
      user_adjusted: userAdjusted,
      lifecycle: viewportLifecycle,
    });
  };

  const runtimeDiagnostics = (): RagGraphRuntimeDiagnostics => {
    const diagnostics = graph?.getDiagnostics();
    return Object.freeze({
      requested_backend: options.backend ?? "auto",
      selected_backend: diagnostics?.backend ?? "none",
      device_pixel_ratio: window.devicePixelRatio,
      graph_revision: graphRevision,
      topology_revision: diagnostics?.topologySyncRevision ?? 0,
      camera_revision: diagnostics?.cameraRevision ?? 0,
      picking_revision: diagnostics?.pickingRevision ?? 0,
      picking_mode: diagnostics?.pickingMode ?? "none",
    });
  };

  const publishDiagnostics = (): void => {
    const nodeTargets = projectedTargets(visibleNodeIds);
    options.canvas.dataset.selectedNodeId = selectedNodeId ?? "";
    options.canvas.dataset.hitNodeIds = JSON.stringify([...hitNodeIds]);
    options.canvas.dataset.hitTargets = JSON.stringify(hitTargets());
    options.canvas.dataset.nodeTargets = JSON.stringify(nodeTargets);
    options.canvas.dataset.viewport = JSON.stringify(viewportDiagnostics());
    options.canvas.dataset.cameraPose = JSON.stringify(currentCameraPose());
    options.canvas.dataset.nodeColors = JSON.stringify(visibleNodeIds.flatMap(id => baseColors.has(id)
      ? [{ node_id: id, base_color: baseColors.get(id)! }] : []));
    options.canvas.dispatchEvent(new Event("rag-camera-frame"));
    options.canvas.dataset.rendererDiagnostics = JSON.stringify(runtimeDiagnostics());
  };

  const updateViewport = (): void => {
    scheduledViewportFrame = 0;
    if (!graph) return;
    const measured = viewport();
    if (!measured) {
      viewportLifecycle = "waiting";
      publishDiagnostics();
      return;
    }
    const sizeChanged = !lastViewport || measured.width !== lastViewport.width || measured.height !== lastViewport.height;
    if (hasGraphData && (framePending || (sizeChanged && !userAdjusted))) {
      if (frameVisibleGraph(graph, options.canvas)) automaticFrameCount += 1;
      framePending = false;
    }
    lastViewport = measured;
    if (sizeChanged || framePending || !userAdjusted) {
      // Keep overview nodes legible on narrow viewports; zoom still behaves naturally.
      updateNodeScale(measured.height);
    }
    viewportUpdateCount += 1;
    viewportLifecycle = "ready";
    graph.render();
    publishDiagnostics();
  };

  const scheduleViewportUpdate = (): void => {
    if (!graph || scheduledViewportFrame) return;
    scheduledViewportFrame = requestAnimationFrame(updateViewport);
  };

  const markPointerNavigation = (event: PointerEvent): void => {
    if (event.buttons !== 0) {
      userAdjusted = true;
      stopCamera();
      publishDiagnostics();
    }
  };
  const markWheelNavigation = (): void => {
    stopCamera();
    userAdjusted = true;
    publishDiagnostics();
  };
  options.canvas.addEventListener("pointermove", markPointerNavigation, { passive: true });
  options.canvas.addEventListener("wheel", markWheelNavigation, { passive: true });
  const resizeObserver = new ResizeObserver(scheduleViewportUpdate);
  resizeObserver.observe(options.canvas);

  const applyInteractionState = (): void => {
    if (!graph) return;
    const view = graph.getGraphView();
    graph.setNodeFlagsMany(hitNodeIds, 0, NodeFlags.Focused);
    hitNodeIds = new Set([...hitNodeIds].filter((nodeId) => view.hasNode(nodeId)));
    graph.setNodeFlagsMany(hitNodeIds, NodeFlags.Focused);
    if (selectedNodeId && view.hasNode(selectedNodeId)) graph.setSelection([selectedNodeId]);
    else graph.clearSelection();
    graph.setLinkStyle({
      width: (link) => hitNodeIds.has(String(link.source)) && hitNodeIds.has(String(link.target))
        ? (link.data?.kind === "reference" ? 3.4 : 2.5)
        : (link.data?.kind === "reference" ? 1.1 : 0.6),
      color: (link) => hitNodeIds.has(String(link.source)) && hitNodeIds.has(String(link.target))
        ? graphColorNumber("selected")
        : (link.data?.kind === "reference" ? graphColorNumber("reference") : graphColorNumber("link")),
      opacity: 0.38,
    });
    // Global flow would imply retrieval traversed unrelated edges. Playback highlights real IDs.
    graph.setLinkFlow({ enabled: false });
    options.canvas.dataset.linkFlow = "false";
  };

  return {
    mode: "tsl",
    backend: startup.renderer.selected,
    render(positioned: PositionedGraph): void {
      if (!graph) return;
      graphRevision += 1;
      stopCamera();nodeMotion.cancelAll(false);dirtyMotionIds.clear();
      const priorIds = new Set(visibleNodeIds);
      const measured = viewport();
      const viewportAspect = measured ? measured.width / measured.height : 1;
      const horizontalScale = Math.min(1.3, Math.max(1, Math.sqrt(viewportAspect)));
      graph.setData({
        nodes: positioned.nodes.map((node) => ({
          id: node.id,
          data: { kind: node.kind, record_id: node.record_id, source_id: node.source_id, path: node.path },
          initialPosition: { x: node.x * horizontalScale, y: node.y, z: node.kind === "source" ? 2 : node.kind === "folder" ? 1 : 0 },
          fixed: { x: node.x * horizontalScale, y: node.y, z: node.kind === "source" ? 2 : node.kind === "folder" ? 1 : 0 },
        })),
        links: positioned.links.map((link) => ({ id: link.id, source: link.source, target: link.target, data: { kind: link.kind } })),
      });
      visibleNodeIds = positioned.nodes.map((node) => node.id);
      const currentIds = new Set(visibleNodeIds);
      for (const id of baseColors.keys()) if (!currentIds.has(id)) baseColors.delete(id);
      options.canvas.dataset.motionEnabled=String(motionEnabled);
      hasGraphData = true;
      framePending = !userAdjusted;
      applyInteractionState();
      if (measured) { updateViewport();spawn(visibleNodeIds.filter(id=>!priorIds.has(id))); }
      else {
        viewportLifecycle = "waiting";
        publishDiagnostics();
      }
    },
    setMotionEnabled(enabled:boolean):void { motionEnabled=enabled;if(!enabled){stopCamera();nodeMotion.cancelAll(true);}options.canvas.dataset.motionEnabled=String(enabled); },
    replaySpawn():void { if(!motionEnabled)return;spawn(visibleNodeIds);if(graph&&!userAdjusted){const to=graph.getCameraPose();if(to){const from={position:{x:to.position.x,y:to.position.y,z:to.position.z*1.12},target:to.target};graph.setCameraPose(from);fly(from,to,1200);}} },
    stopMotion():void {stopCamera();nodeMotion.cancelAll(true);},
    refreshViewport(): void {
      scheduleViewportUpdate();
    },
    fit(): void {
      if (!graph || !hasGraphData) return;
      userAdjusted = false;
      framePending = true;
      updateViewport();
    },
    getCameraPose: currentCameraPose,
    setCameraPose(pose: CameraPose): void {
      const next = copyCameraPose(pose);
      if (!graph) return;
      stopCamera();
      userAdjusted = true;
      framePending = false;
      graph.setCameraPose(next);
      const measured = viewport();
      if (measured) updateNodeScale(measured.height);
      graph.render();
      publishDiagnostics();
    },
    setInteractionState(nextSelectedNodeId: string | null, nextHitNodeIds: readonly string[]): void {
      if (graph) graph.setNodeFlagsMany(hitNodeIds, 0, NodeFlags.Focused);
      const previousSelection=selectedNodeId;
      selectedNodeId = nextSelectedNodeId;
      hitNodeIds = new Set(nextHitNodeIds);
      applyInteractionState();
      if(graph&&selectedNodeId&&selectedNodeId!==previousSelection){nodeMotion.pulse(selectedNodeId,{peak:1.7,durationMs:700});const from=graph.getCameraPose(),point=graph.getNodePosition(selectedNodeId);if(from&&point&&!userAdjusted){const dx=(point.x-from.target.x)*.12,dy=(point.y-from.target.y)*.12;fly(from,{position:{x:from.position.x+dx,y:from.position.y+dy,z:from.position.z},target:{x:from.target.x+dx,y:from.target.y+dy,z:from.target.z}},720);}}
      graph?.render();
      publishDiagnostics();
    },
    diagnostics(): RagGraphRendererDiagnostics {
      return Object.freeze({
        runtime: runtimeDiagnostics(),
        selected_node_id: selectedNodeId,
        hit_node_ids: Object.freeze([...hitNodeIds]),
        hit_targets: Object.freeze(hitTargets()),
        node_targets: Object.freeze([...projectedTargets(visibleNodeIds)]),
        viewport: viewportDiagnostics(),
        camera_pose: currentCameraPose(),
        node_colors: Object.freeze(visibleNodeIds.flatMap(id => baseColors.has(id)
          ? [Object.freeze({ node_id: id, base_color: baseColors.get(id)! })] : [])),
      });
    },
    clear(): void {
      stopCamera();nodeMotion.cancelAll(false);dirtyMotionIds.clear();
      graphRevision += 1;
      selectedNodeId = null;
      hitNodeIds.clear();
      visibleNodeIds = [];
      baseColors.clear();
      hasGraphData = false;
      framePending = false;
      userAdjusted = false;
      if (graph) {
        graph.clear();
        graph.render();
      }
      publishDiagnostics();
    },
    dispose(): void {
      if (!graph) return;
      stopCamera();nodeMotion.dispose();if(motionStyleFrame)cancelAnimationFrame(motionStyleFrame);motionStyleFrame=0;dirtyMotionIds.clear();
      resizeObserver.disconnect();
      if (scheduledViewportFrame) cancelAnimationFrame(scheduledViewportFrame);
      scheduledViewportFrame = 0;
      options.canvas.removeEventListener("pointermove", markPointerNavigation);
      options.canvas.removeEventListener("wheel", markWheelNavigation);
      offClick();
      offLoss();
      offError();
      graph.dispose();
      graph = null;
      baseColors.clear();
      selectedNodeId = null;
      hitNodeIds.clear();
      visibleNodeIds = [];
      hasGraphData = false;
      framePending = false;
      viewportLifecycle = "disposed";
      publishDiagnostics();
    },
  };
}
