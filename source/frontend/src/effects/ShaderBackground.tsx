import { useEffect, useRef } from "react";
import * as THREE from "three";
import { releaseWebGLRenderer } from "../graphics/webglLifecycle";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    vec4 top = vec4(0.043, 0.045, 0.09, 1.0);
    vec4 bot = vec4(0.12, 0.10, 0.45, 1.0);
    float f = 4.2;
    float a1 = 0.24;
    float a2 = 0.09;
    float s1 = 0.044;
    float s2 = 0.064;
    float w1 = sin((uv.x + uTime * s1) * f) * a1;
    float w2 = sin((uv.x + uTime * s2) * f) * a2;
    float band = smoothstep(0.0, 0.06, w1 + w2 + 1.0 - uv.y * 2.5);
    vec4 gradient = vec4(mix(bot.rgb, top.rgb, pow(uv.y, 2.0)), 1.0);
    vec4 flare = vec4(0.65, 0.53, 0.98, 1.0) * band * 0.8;
    gl_FragColor = mix(gradient, flare, clamp(band, 0.0, 1.0));
  }
`;

function AnimatedShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let releaseRenderer: (() => void) | null = null;
    let setupFrame = window.requestAnimationFrame(() => {
      setupFrame = 0;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      } catch (error) {
        console.warn("WebGL background unavailable", error);
        return;
      }

      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, 2, 0.1, 1000);
      camera.position.z = 1;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      const drawingBufferSize = new THREE.Vector2();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      scene.add(plane);

      let animationFrame = 0;
      let visible = !document.hidden;

      const resize = () => {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(drawingBufferSize);
        material.uniforms.uResolution.value.copy(drawingBufferSize);

        const fovRadians = (camera.fov * Math.PI) / 180;
        const planeHeight = 2 * Math.tan(fovRadians / 2) * camera.position.z;
        const planeWidth = planeHeight * camera.aspect;
        plane.scale.set((planeWidth / 2) * 1.01, (planeHeight / 2) * 1.01, 1);
      };

      const render = () => renderer.render(scene, camera);
      const stopAnimation = () => {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      };
      const scheduleAnimation = () => {
        if (!visible || animationFrame) return;
        animationFrame = window.requestAnimationFrame(tick);
      };
      const tick = (time: number) => {
        animationFrame = 0;
        if (!visible) return;
        material.uniforms.uTime.value = time / 1000;
        render();
        scheduleAnimation();
      };
      const handleVisibility = () => {
        visible = !document.hidden;
        if (visible) {
          render();
          scheduleAnimation();
        } else {
          stopAnimation();
        }
      };
      resize();
      render();
      scheduleAnimation();
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", handleVisibility);

      releaseRenderer = () => {
        try {
          stopAnimation();
          window.removeEventListener("resize", resize);
          document.removeEventListener("visibilitychange", handleVisibility);
          scene.remove(plane);
          plane.geometry.dispose();
          material.dispose();
        } finally {
          releaseWebGLRenderer(renderer);
        }
      };
    });

    return () => {
      if (setupFrame) window.cancelAnimationFrame(setupFrame);
      releaseRenderer?.();
    };
  }, []);

  return <canvas ref={canvasRef} className="shader-background" aria-hidden="true" />;
}

export function ShaderBackground() {
  const reducedMotion = usePrefersReducedMotion();
  if (reducedMotion) {
    return <div className="shader-background shader-background-static" aria-hidden="true" />;
  }
  return <AnimatedShaderBackground />;
}
