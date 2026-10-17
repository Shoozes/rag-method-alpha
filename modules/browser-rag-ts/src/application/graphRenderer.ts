import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { createForceGraph3D, createThreePlatform, NodeFlags } from "@ours/forcegraph-tsl";
import { createNodeSpawnMotion } from "../presentation/nodeSpawnMotion.js";
import { sampleCameraPoseTween } from "@ours/forcegraph-tsl/camera";
import { planPerspectiveCameraFrame } from "@ours/forcegraph-tsl/camera";
import type { CameraPose, ForceGraph, NodeSurfaceOptions, RendererBackend } from "@ours/forcegraph-tsl";
import type { PositionedGraph, PositionedGraphNode } from "./layoutGraph.js";
import { graphColorNumber, graphFamilyColorNumber } from "./graphPalette.js";

export type RagRendererMode = "tsl" | "svg";
export type RagRendererBackend = "auto" | "webgl2";

export interface RagNodePosition {
  readonly node_id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A temporary renderer-only override; original layout coordinates and colors remain authoritative. */
export interface RagNodePresentation {
  readonly positions: readonly RagNodePosition[];
  readonly active: boolean;
  update(positions: readonly RagNodePosition[], colorProgress?: number): boolean;
  restore(): void;
}

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
  beginNodePresentation(nodeIds: readonly string[], presentation?: { readonly targetColor?: number }): RagNodePresentation | null;
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
  readonly presentation?: "memory-spatial";
  readonly node_positions?: readonly { readonly node_id: string; readonly x: number; readonly y: number; readonly z: number }[];
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
  /** Memory-spatial body radius in CSS pixels, excluding its optional aura. */
  readonly radius_px?: number;
  /** Memory-spatial camera-forward distance in world units; smaller is nearer. */
  readonly depth?: number;
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
  /** Preserve host-supplied XYZ and use the memory-only spatial camera and surface. */
  readonly presentation?: "memory-spatial";
  readonly onNodeActivate: (nodeId: string) => void;
  readonly onTerminalFailure: (message: string) => void;
}

function nodeRadius(node: { readonly data?: RenderNodeData }): number {
  return node.data?.kind === "source" ? 3.8 : node.data?.kind === "folder" ? 6.5 : 1.9;
}

function memoryNodeRadius(node: { readonly data?: RenderNodeData }): number {
  return node.data?.kind === "source" ? 7.5 : node.data?.kind === "folder" ? 8.5 : 6;
}

function memoryMinimumPixels(kind: RenderNodeData["kind"] | undefined): number {
  return kind === "source" ? 9 : kind === "folder" ? 10 : 8;
}

/** The engine packs RGB bytes directly into linear shader attributes. */
function memoryLinearColor(srgb: number): number {
  const channel = (shift: number): number => {
    const value = ((srgb >>> shift) & 255) / 255;
    return Math.round((value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * 255);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
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

/** Fit actual nodes in the current camera basis, rather than empty AABB corners. */
function frameSpatialMemory(
  graph: ForceGraph<RenderNodeData, { readonly kind: string }>,
  canvas: HTMLCanvasElement,
  nodeIds: readonly string[],
): CameraPose | null {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const view = graph.getGraphView();
  const nodes = nodeIds.flatMap(id => {
    const point = graph.getNodePosition(id), node = view.getNode(id);
    return point && node ? [{ point, node }] : [];
  });
  if (!nodes.length || width <= 0 || height <= 0) return null;
  const pose = graph.getCameraPose();
  const direction = pose ? { x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z }
    : { x: 0.32, y: 0.20, z: 1 };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const normal = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const sideLength = Math.hypot(normal.x, normal.z);
  const right = sideLength > 0.000001 ? { x: normal.z / sideLength, y: 0, z: -normal.x / sideLength } : { x: 1, y: 0, z: 0 };
  const up = { x: normal.y * right.z, y: normal.z * right.x - normal.x * right.z, z: -normal.y * right.x };
  const dot = (point: { x: number; y: number; z: number }, axis: typeof normal): number => point.x * axis.x + point.y * axis.y + point.z * axis.z;
  const projected = nodes.map(({ point, node }) => ({ x: dot(point, right), y: dot(point, up), z: dot(point, normal), node }));
  const center = {
    x: (Math.min(...projected.map(point => point.x)) + Math.max(...projected.map(point => point.x))) / 2,
    y: (Math.min(...projected.map(point => point.y)) + Math.max(...projected.map(point => point.y))) / 2,
    z: (Math.min(...projected.map(point => point.z)) + Math.max(...projected.map(point => point.z))) / 2,
  };
  const verticalTangent = Math.tan(25 * Math.PI / 180), horizontalTangent = verticalTangent * width / height;
  // Use 82% of each dimension, then retain a small fixed label margin.
  const horizontalLimit = horizontalTangent * Math.max(0.35, 0.82 - 24 / width);
  const verticalLimit = verticalTangent * Math.max(0.35, 0.82 - 24 / height);
  let distance = 32;
  for (const point of projected) {
    const x = Math.abs(point.x - center.x), y = Math.abs(point.y - center.y), depth = point.z - center.z;
    const radius = memoryNodeRadius(point.node), pixelSlope = memoryMinimumPixels(point.node.data?.kind) * 2 * verticalTangent / height;
    distance = Math.max(distance, depth + radius + 1,
      depth + (x + radius) / horizontalLimit, depth + (y + radius) / verticalLimit,
      depth + x / Math.max(horizontalLimit - pixelSlope, horizontalLimit * 0.2),
      depth + y / Math.max(verticalLimit - pixelSlope, verticalLimit * 0.2));
  }
  const target = {
    x: right.x * center.x + up.x * center.y + normal.x * center.z,
    y: right.y * center.x + up.y * center.y + normal.y * center.z,
    z: right.z * center.x + up.z * center.y + normal.z * center.z,
  };
  const frame = { target, position: { x: target.x + normal.x * distance, y: target.y + normal.y * distance, z: target.z + normal.z * distance } };
  graph.setCameraPose(frame);
  return frame;
}

export async function createTslRagGraphRenderer(options: CreateRagGraphRendererOptions): Promise<RagGraphRenderer> {
  const memorySpatial = options.presentation === "memory-spatial";
  const scopeColoredSurface = options.nodeSurface === "scope-colored";
  const preserveNodeColors = memorySpatial || options.preserveNodeColors;
  // The pinned native "metallic" profile supplies sphere-impostor shading.
  // Zero metalness removes its additive white highlight and retains scope hues.
  const memorySurface = (color: number): NodeSurfaceOptions => ({
    profile: "metallic", metalness: 0, roughness: 0.82, emissive: 0.04,
    selectionEffect: { enabled: true, bubbleScale: 1.5, intensity: 0.22, color: memoryLinearColor(color), breathAmount: 0 },
  });
  let selectionSurfaceColor = 0x0ea5ff;
  const baseColors = new Map<string, number>();
  const presentationColors = new Map<string, number>();
  const displayedNodeColor = (id: string): number | undefined => presentationColors.get(id) ?? baseColors.get(id);
  const resolvedNodeColor = (node: { readonly id: string | number; readonly data?: RenderNodeData }): number => {
    const id = String(node.id), supplied = options.nodeColor?.(id);
    if (supplied !== undefined && (!Number.isInteger(supplied) || supplied < 0 || supplied > 0xffffff)) {
      throw new Error("Graph node color must be an RGB integer from 0 to 0xffffff.");
    }
    const color = supplied ?? nodeColor(node);
    baseColors.set(id, color);
    const displayed = presentationColors.get(id) ?? color;
    return memorySpatial ? memoryLinearColor(displayed) : displayed;
  };
  let graph: ForceGraph<RenderNodeData, { readonly kind: string }> | null = await createForceGraph3D<RenderNodeData, { readonly kind: string }>({
    platform: createThreePlatform({ THREE, TSL }),
    host: { mode: "managed", canvas: options.canvas },
    renderer: {
      backend: (options.backend ?? "auto") as RendererBackend,
      frameLoop: "demand",
      linkWidthUnit: "pixel",
      pixelRatio: { minimum: 1, maximum: 2 },
      nodeSurface: memorySpatial ? memorySurface(selectionSurfaceColor) : {
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
      cameraPose: { position: { x: memorySpatial ? 38.4 : 0, y: memorySpatial ? 24 : 0, z: 120 }, target: { x: 0, y: 0, z: 0 } },
    },
    layout: { backend: "local", autoStart: false, dimensions: memorySpatial ? 3 : 2, seed: 20260919 },
    nodes: { radius: memorySpatial ? memoryNodeRadius : nodeRadius, color: resolvedNodeColor },
    links: {
      width: (link) => link.data?.kind === "reference" ? 1.6 : 1.05,
      color: (link) => link.data?.kind === "reference" ? graphColorNumber("reference") : graphColorNumber("link"),
      opacity: 0.56,
    },
    interaction: { hover: true, dragNodes: false, selection: "single", navigation: true },
    stateTheme: {
      // Fixed memory-layout coordinates are placement, not a semantic Pin.
      // Preserve scope hues instead of the producer's warm pinned-state tint.
      ...(memorySpatial ? { pinned: { colorMix: 0 } } : {}),
      selected: { color: graphColorNumber("selected"), colorMix: preserveNodeColors ? 0 : 0.98, scale: memorySpatial ? 1.22 : 1.42 },
      focused: { color: graphColorNumber("hit"), colorMix: preserveNodeColors ? 0 : 0.82, scale: memorySpatial ? 1.12 : 1.2 },
      ...(memorySpatial ? { hovered: { colorMix: 0, scale: 1.06 } } : scopeColoredSurface ? { hovered: { colorMix: 0 } } : {}),
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
  const renderedNodeData = new Map<string, RenderNodeData>();
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
  let nodePresentation: RagNodePresentation | null = null;
  const restoreNodePresentation = (): void => { nodePresentation?.restore(); };
  const stopCamera = ():void => { if(cameraFrame)cancelAnimationFrame(cameraFrame);cameraFrame=0; };
  const nodeMotion = createNodeSpawnMotion({
    reducedMotion:()=>!motionEnabled,
    refreshNodeStyles:(ids)=>{ for(const id of ids)dirtyMotionIds.add(id);if(!motionStyleFrame)motionStyleFrame=requestAnimationFrame(()=>{motionStyleFrame=0;if(graph){graph.refreshNodeStyles(dirtyMotionIds);graph.render();options.canvas.dataset.spawnActive=String(nodeMotion.activeCount);if(memorySpatial)publishDiagnostics();}dirtyMotionIds.clear();}); },
    onError:(error)=>options.onTerminalFailure(error instanceof Error?error.message:String(error)),
  });
  const styledRadius = (node:{readonly id:string|number;readonly data?:RenderNodeData}):number => {
    const minimumPixels = memorySpatial ? memoryMinimumPixels(node.data?.kind)
      : (node.data?.kind === "folder" ? 2.8 : node.data?.kind === "source" ? 1.8 : 1);
    let nodeUnitsPerPixel = unitsPerPixel;
    if (memorySpatial && graph) {
      const pose = graph.getCameraPose(), point = graph.getNodePosition(String(node.id));
      if (pose && point) {
        const x = pose.position.x - pose.target.x, y = pose.position.y - pose.target.y, z = pose.position.z - pose.target.z;
        const distance = Math.hypot(x, y, z);
        const depth = ((pose.position.x - point.x) * x + (pose.position.y - point.y) * y + (pose.position.z - point.z) * z) / distance;
        nodeUnitsPerPixel *= Math.max(0.1, depth) / distance;
      }
    }
    return Math.max(memorySpatial ? memoryNodeRadius(node) : nodeRadius(node), nodeUnitsPerPixel * minimumPixels) * nodeMotion.scale(String(node.id));
  };
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
    const direction = memorySpatial ? { x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z } : null;
    const distance = direction ? Math.hypot(direction.x, direction.y, direction.z) : 0;
    const focalPixels = measured.height / (2 * Math.tan(25 * Math.PI / 180));
    return [...nodeIds].flatMap((nodeId) => {
      const position = graph?.getNodePosition(nodeId);
      if (!position) return [];
      const projected = new THREE.Vector3(position.x, position.y, position.z).project(camera);
      const visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      let body: { radius_px: number; depth: number } | undefined;
      if (direction && distance > 0) {
        const depth = ((pose.position.x - position.x) * direction.x + (pose.position.y - position.y) * direction.y
          + (pose.position.z - position.z) * direction.z) / distance;
        const data = renderedNodeData.get(nodeId);
        // Native state appearances multiply; these are the wrapper-owned flags.
        const stateScale = (selectedNodeId === nodeId ? 1.22 : 1) * (hitNodeIds.has(nodeId) ? 1.12 : 1);
        const pixels = data && depth > 0 ? styledRadius({ id: nodeId, data }) * stateScale * focalPixels / depth : 0;
        body = { depth: Number.isFinite(depth) ? depth : 0, radius_px: Number.isFinite(pixels) ? Math.max(0, pixels) : 0 };
      }
      return [{
        node_id: nodeId,
        x: ((projected.x + 1) / 2) * measured.width,
        y: ((1 - projected.y) / 2) * measured.height,
        visible: visible && (!memorySpatial || Boolean(body && body.depth > 0 && body.radius_px > 0)),
        ...(body || {}),
      }];
    });
  };

  const hitTargets = (): readonly RagGraphHitTarget[] => {
    return projectedTargets(hitNodeIds).filter((target) => target.visible).map(({ node_id, x, y }) => ({ node_id, x, y }));
  };

  const nodePositions = (): NonNullable<RagGraphRendererDiagnostics["node_positions"]> => visibleNodeIds.flatMap(nodeId => {
    const point = graph?.getNodePosition(nodeId);
    return point ? [Object.freeze({ node_id: nodeId, x: point.x, y: point.y, z: point.z })] : [];
  });

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
    options.canvas.dataset.nodeColors = JSON.stringify(visibleNodeIds.flatMap(id => displayedNodeColor(id) !== undefined
      ? [{ node_id: id, base_color: displayedNodeColor(id)! }] : []));
    if (memorySpatial) {
      options.canvas.dataset.presentation = "memory-spatial";
      options.canvas.dataset.nodePositions = JSON.stringify(nodePositions());
    }
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
    if (sizeChanged) restoreNodePresentation();
    if (hasGraphData && (framePending || (sizeChanged && !userAdjusted))) {
      const frame = memorySpatial ? frameSpatialMemory(graph, options.canvas, visibleNodeIds) : frameVisibleGraph(graph, options.canvas);
      if (frame) automaticFrameCount += 1;
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
      restoreNodePresentation();
      userAdjusted = true;
      stopCamera();
      publishDiagnostics();
    }
  };
  const markWheelNavigation = (): void => {
    restoreNodePresentation();
    stopCamera();
    userAdjusted = true;
    publishDiagnostics();
  };
  options.canvas.addEventListener("pointermove", markPointerNavigation, { passive: true });
  options.canvas.addEventListener("wheel", markWheelNavigation, { passive: true });
  const resizeObserver = new ResizeObserver(scheduleViewportUpdate);
  resizeObserver.observe(options.canvas);

  const syncSelectedSurface = (): void => {
    if (graph && memorySpatial && selectedNodeId) {
      const color = displayedNodeColor(selectedNodeId);
      if (color !== undefined && color !== selectionSurfaceColor) {
        selectionSurfaceColor = color;
        graph.setNodeSurface(memorySurface(color));
      }
    }
  };

  const applyInteractionState = (): void => {
    if (!graph) return;
    const view = graph.getGraphView();
    graph.setNodeFlagsMany(hitNodeIds, 0, NodeFlags.Focused);
    hitNodeIds = new Set([...hitNodeIds].filter((nodeId) => view.hasNode(nodeId)));
    graph.setNodeFlagsMany(hitNodeIds, NodeFlags.Focused);
    if (selectedNodeId && view.hasNode(selectedNodeId)) graph.setSelection([selectedNodeId]);
    else graph.clearSelection();
    syncSelectedSurface();
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
      if (memorySpatial && positioned.nodes.some(node => ![node.x, node.y, node.z].every(Number.isFinite))) {
        throw new Error("Spatial memory nodes require finite host-supplied X, Y and Z coordinates.");
      }
      restoreNodePresentation();
      graphRevision += 1;
      stopCamera();nodeMotion.cancelAll(false);dirtyMotionIds.clear();
      const priorIds = new Set(visibleNodeIds);
      const measured = viewport();
      const viewportAspect = measured ? measured.width / measured.height : 1;
      const horizontalScale = memorySpatial ? 1 : Math.min(1.3, Math.max(1, Math.sqrt(viewportAspect)));
      graph.setData({
        nodes: positioned.nodes.map((node) => ({
          id: node.id,
          data: { kind: node.kind, record_id: node.record_id, source_id: node.source_id, path: node.path },
          initialPosition: { x: node.x * horizontalScale, y: node.y, z: memorySpatial ? node.z! : node.kind === "source" ? 2 : node.kind === "folder" ? 1 : 0 },
          fixed: { x: node.x * horizontalScale, y: node.y, z: memorySpatial ? node.z! : node.kind === "source" ? 2 : node.kind === "folder" ? 1 : 0 },
        })),
        links: positioned.links.map((link) => ({ id: link.id, source: link.source, target: link.target, data: { kind: link.kind } })),
      });
      renderedNodeData.clear();
      if (memorySpatial) for (const node of positioned.nodes) renderedNodeData.set(node.id,
        { kind: node.kind, record_id: node.record_id, source_id: node.source_id, path: node.path });
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
    setMotionEnabled(enabled:boolean):void { motionEnabled=enabled;if(!enabled){restoreNodePresentation();stopCamera();nodeMotion.cancelAll(true);}options.canvas.dataset.motionEnabled=String(enabled); },
    replaySpawn():void { if(!motionEnabled)return;spawn(visibleNodeIds);if(graph&&!userAdjusted){const to=graph.getCameraPose();if(to){const from={position:memorySpatial?{x:to.target.x+(to.position.x-to.target.x)*1.12,y:to.target.y+(to.position.y-to.target.y)*1.12,z:to.target.z+(to.position.z-to.target.z)*1.12}:{x:to.position.x,y:to.position.y,z:to.position.z*1.12},target:to.target};graph.setCameraPose(from);fly(from,to,1200);}} },
    stopMotion():void {restoreNodePresentation();stopCamera();nodeMotion.cancelAll(true);},
    refreshViewport(): void {
      scheduleViewportUpdate();
    },
    fit(): void {
      if (!graph || !hasGraphData) return;
      restoreNodePresentation();
      userAdjusted = false;
      framePending = true;
      updateViewport();
    },
    getCameraPose: currentCameraPose,
    setCameraPose(pose: CameraPose): void {
      const next = copyCameraPose(pose);
      if (!graph) return;
      restoreNodePresentation();
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
    beginNodePresentation(nodeIds: readonly string[], presentation: { readonly targetColor?: number } = {}): RagNodePresentation | null {
      if (!graph || !memorySpatial || !motionEnabled || !Array.isArray(nodeIds) || !nodeIds.length || nodeIds.length > 12
        || new Set(nodeIds).size !== nodeIds.length || nodeIds.some(id => !visibleNodeIds.includes(id))
        || !presentation || typeof presentation !== "object"
        || (presentation.targetColor !== undefined && (!Number.isInteger(presentation.targetColor)
          || presentation.targetColor < 0 || presentation.targetColor > 0xffffff))) return null;
      const targetColor = presentation.targetColor;
      restoreNodePresentation();
      const revision = graphRevision;
      const originals = nodeIds.flatMap(node_id => {
        const point = graph?.getNodePosition(node_id);
        return point && [point.x, point.y, point.z].every(Number.isFinite)
          ? [Object.freeze({ node_id, x: point.x, y: point.y, z: point.z })] : [];
      });
      if (originals.length !== nodeIds.length) return null;
      const originalColors = nodeIds.map(id => displayedNodeColor(id));
      if (targetColor !== undefined && originalColors.some(color => color === undefined)) return null;
      stopCamera(); nodeMotion.cancelAll(true);
      let active = true;
      const current = (): boolean => active && Boolean(graph) && graphRevision === revision && nodePresentation === lease;
      const paint = (positions: readonly RagNodePosition[]): void => {
        if (!graph) return;
        for (const point of positions) graph.setNodeFixed(point.node_id, { x: point.x, y: point.y, z: point.z });
        graph.refreshNodeStyles(nodeIds); syncSelectedSurface(); graph.render(); publishDiagnostics();
      };
      const lease: RagNodePresentation = Object.freeze({
        positions: Object.freeze(originals),
        get active(): boolean { return current(); },
        update(positions: readonly RagNodePosition[], colorProgress = 0): boolean {
          if (!current() || !motionEnabled || !Array.isArray(positions) || positions.length !== originals.length
            || !Number.isFinite(colorProgress) || colorProgress < 0 || colorProgress > 1
            || positions.some((point, index) => point?.node_id !== originals[index]!.node_id
              || ![point.x, point.y, point.z].every(value => Number.isFinite(value) && Math.abs(value) <= 100_000))) return false;
          if (targetColor !== undefined) {
            for (const [index, id] of nodeIds.entries()) {
              const source = originalColors[index]!;
              // Interpolate canonical sRGB anchors, then use the same linear
              // material conversion as every settled memory body.
              let color = 0;
              for (const shift of [16, 8, 0]) color |= Math.round(((source >> shift) & 255)
                + (((targetColor >> shift) & 255) - ((source >> shift) & 255)) * colorProgress) << shift;
              presentationColors.set(id, color);
            }
          }
          paint(positions); return true;
        },
        restore(): void {
          if (!active) return;
          const restore = current(); active = false;
          if (nodePresentation === lease) nodePresentation = null;
          for (const id of nodeIds) presentationColors.delete(id);
          if (restore) paint(originals);
        },
      });
      nodePresentation = lease;
      return lease;
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
        node_colors: Object.freeze(visibleNodeIds.flatMap(id => displayedNodeColor(id) !== undefined
          ? [Object.freeze({ node_id: id, base_color: displayedNodeColor(id)! })] : [])),
        ...(memorySpatial ? { presentation: "memory-spatial" as const, node_positions: Object.freeze(nodePositions()) } : {}),
      });
    },
    clear(): void {
      restoreNodePresentation();
      stopCamera();nodeMotion.cancelAll(false);dirtyMotionIds.clear();
      graphRevision += 1;
      selectedNodeId = null;
      hitNodeIds.clear();
      visibleNodeIds = [];
      baseColors.clear();
      presentationColors.clear();
      renderedNodeData.clear();
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
      restoreNodePresentation();
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
      presentationColors.clear();
      renderedNodeData.clear();
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
