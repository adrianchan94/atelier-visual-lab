import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  WebGPURenderer,
  SpriteNodeMaterial,
  StorageInstancedBufferAttribute,
} from 'three/webgpu'
import {
  Fn,
  instanceIndex,
  storage,
  uniform,
  vec2,
  vec3,
  float,
  mx_noise_vec3,
  mix,
  smoothstep,
  uv,
} from 'three/tsl'
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.js'
import type Node from 'three/src/nodes/core/Node.js'
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js'
import type UniformNode from 'three/src/nodes/core/UniformNode.js'

// ~200k particles. State (position + velocity) lives entirely in GPU storage
// buffers; the CPU only seeds them once. On a WebGPU backend a TSL compute
// kernel advects every particle by a divergence-free curl-noise flow plus a
// gentle centering force each frame. On a WebGL2 backend (no compute) the same
// luminous field is reproduced analytically inside the vertex/position node.
const COUNT = 200_000
const SEED_RADIUS = 7

type FloatUniform = UniformNode<'float', number>

// Curl of a vec3 noise potential, by central differences. Divergence-free, so
// it reads as incompressible swirling flow rather than sources/sinks.
function curlNoise(p: Node<'vec3'>): Node<'vec3'> {
  const e = 0.18
  const dx = vec3(e, 0, 0)
  const dy = vec3(0, e, 0)
  const dz = vec3(0, 0, e)

  const px1 = mx_noise_vec3(p.add(dx))
  const px0 = mx_noise_vec3(p.sub(dx))
  const py1 = mx_noise_vec3(p.add(dy))
  const py0 = mx_noise_vec3(p.sub(dy))
  const pz1 = mx_noise_vec3(p.add(dz))
  const pz0 = mx_noise_vec3(p.sub(dz))

  const dFdx = px1.sub(px0)
  const dFdy = py1.sub(py0)
  const dFdz = pz1.sub(pz0)

  const cx = dFdy.z.sub(dFdz.y)
  const cy = dFdz.x.sub(dFdx.z)
  const cz = dFdx.y.sub(dFdy.x)

  return vec3(cx, cy, cz).div(2 * e)
}

// Map a speed scalar to a cold->hot nebula gradient with an additive glow boost.
function speedToColor(speed: Node<'float'>): Node<'vec3'> {
  const cold = vec3(0.08, 0.45, 1.0)
  const hot = vec3(1.0, 0.28, 0.7)
  const t = speed.mul(0.45).clamp(0, 1)
  return mix(cold, hot, t).mul(t.mul(0.9).add(0.7)).mul(1.4)
}

interface ParticleNodes {
  positionNode: Node
  colorNode: Node<'vec3'>
  compute: ComputeNode | null
}

interface ParticleFieldProps {
  onResolved: (webgpu: boolean) => void
}

function ParticleField({ onResolved }: ParticleFieldProps) {
  const glRaw = useThree((s) => s.gl)
  // R3F types state.gl as WebGLRenderer; our async factory always builds a
  // WebGPURenderer, so assert once at this boundary rather than per-property.
  const renderer = useMemo<WebGPURenderer>(
    () => glRaw as unknown as WebGPURenderer,
    [glRaw],
  )
  // `Backend` (the base type) has no discriminant; the concrete WebGPUBackend
  // carries `isWebGPUBackend`. Narrow with `in` so the read is type-checked.
  const useCompute = useMemo(() => {
    const backend = renderer.backend
    return 'isWebGPUBackend' in backend && backend.isWebGPUBackend === true
  }, [renderer])
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const prefersReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Animation clocks shared by both code paths. We never rely on the TSL
  // built-in `deltaTime` inside compute (its update timing across backends is
  // subtle); instead we feed an explicit, clamped step from useFrame.
  const uTime = useMemo<FloatUniform>(() => uniform(0), [])
  const uStep = useMemo<FloatUniform>(() => uniform(0.016), [])
  const uScale = useMemo<FloatUniform>(() => uniform(0.06), [])

  // Storage buffers (allocated once, uploaded lazily on first compute/draw).
  const buffers = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const velocities = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      // Uniform sampling inside a sphere.
      const u = Math.random()
      const v = Math.random()
      const theta = Math.acos(2 * v - 1)
      const phi = 2 * Math.PI * u
      const r = SEED_RADIUS * Math.cbrt(Math.random())
      const sinT = Math.sin(theta)
      const o = i * 3
      positions[o] = r * sinT * Math.cos(phi)
      positions[o + 1] = r * sinT * Math.sin(phi)
      positions[o + 2] = r * Math.cos(theta)
    }
    const positionAttr = new StorageInstancedBufferAttribute(positions, 3)
    const velocityAttr = new StorageInstancedBufferAttribute(velocities, 3)
    return {
      positionStorage: storage(positionAttr, 'vec3', COUNT),
      velocityStorage: storage(velocityAttr, 'vec3', COUNT),
    }
  }, [])

  // Build the node graph for the active backend.
  const nodes = useMemo<ParticleNodes>(() => {
    const { positionStorage, velocityStorage } = buffers

    if (useCompute) {
      // GPU compute path: integrate position + velocity in a storage buffer.
      const computeUpdate = Fn(() => {
        const pos = positionStorage.element(instanceIndex)
        const vel = velocityStorage.element(instanceIndex)

        const fieldP = pos.mul(0.16).add(vec3(0, uTime.mul(0.15), 0))
        const flow = curlNoise(fieldP)
        const accel = flow.mul(3.0).sub(pos.mul(0.9))

        vel.addAssign(accel.mul(uStep))
        vel.mulAssign(0.93)
        pos.addAssign(vel.mul(uStep))
      })().compute(COUNT)

      const positionNode = positionStorage.toAttribute()
      const colorNode = speedToColor(velocityStorage.toAttribute().length())
      return { positionNode, colorNode, compute: computeUpdate }
    }

    // WebGL2 fallback: no compute. Reconstruct a flowing field analytically in
    // the position node, indexed per-instance. Still 100% TSL / NodeMaterial.
    const id = float(instanceIndex)
    const seed = vec3(
      id.mul(0.0123),
      id.mul(0.0071).add(11.3),
      id.mul(0.0177).add(31.7),
    )
    const base = mx_noise_vec3(seed).mul(SEED_RADIUS)
    const fieldP = base.mul(0.16).add(vec3(0, uTime.mul(0.15), 0))
    const flow = curlNoise(fieldP)
    const positionNode = base.add(flow.mul(1.3))
    const colorNode = speedToColor(flow.length())
    return { positionNode, colorNode, compute: null }
  }, [buffers, useCompute, uTime, uStep])

  // Instanced billboard sprites. positionNode overrides the per-instance
  // center; the plane corners expand around it in view space (sizeAttenuation).
  const mesh = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new SpriteNodeMaterial()
    material.positionNode = nodes.positionNode
    material.colorNode = nodes.colorNode
    material.scaleNode = uScale

    // Soft circular falloff so each sprite reads as a glowing point.
    const d = uv().sub(vec2(0.5, 0.5)).length()
    material.opacityNode = smoothstep(0.0, 0.5, d).oneMinus().mul(0.5)

    material.transparent = true
    material.depthWrite = false
    material.depthTest = false
    material.blending = THREE.AdditiveBlending

    const instanced = new THREE.InstancedMesh(geometry, material, COUNT)
    // InstancedMesh zero-fills instanceMatrix; positionNode supplies the real
    // position, but the instance matrix still multiplies it — so seed identity.
    const im = instanced.instanceMatrix.array
    for (let i = 0; i < COUNT; i++) {
      const o = i * 16
      im[o] = 1
      im[o + 5] = 1
      im[o + 10] = 1
      im[o + 15] = 1
    }
    instanced.instanceMatrix.needsUpdate = true
    instanced.frustumCulled = false
    return instanced
  }, [nodes, uScale])

  useEffect(() => onResolved(useCompute), [useCompute, onResolved])

  useEffect(() => {
    return () => {
      mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      mesh.dispose()
    }
  }, [mesh])

  const speedScale = prefersReduced ? 0.3 : 1

  useFrame((_, delta) => {
    const step = Math.min(delta, 1 / 30) * speedScale
    uStep.value = step
    uTime.value += step

    const group = meshRef.current
    if (group) group.rotation.y += delta * 0.04 * speedScale

    if (nodes.compute) {
      void renderer.compute(nodes.compute)
    }
  })

  return <primitive ref={meshRef} object={mesh} />
}

export default function WebGPUCompute() {
  const supportsWebGPU = useMemo(
    () => typeof navigator !== 'undefined' && !!navigator.gpu,
    [],
  )
  const [isFallback, setIsFallback] = useState(!supportsWebGPU)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04060f' }}>
      <Canvas
        dpr={[1, 2]}
        gl={async (defaultProps) => {
          // `defaultProps` is R3F's DefaultGLProps; it's structurally
          // compatible with WebGPURendererParameters (canvas, antialias,
          // alpha, powerPreference) but TS can't unify the two renderer
          // param shapes, so assert once at this construction boundary.
          const params = defaultProps as unknown as WebGPURendererParameters
          const renderer = new WebGPURenderer({
            ...params,
            forceWebGL: !supportsWebGPU,
          })
          await renderer.init()
          return renderer
        }}
        camera={{ position: [0, 0, 16], fov: 55, near: 0.1, far: 100 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#04060f']} />
        <ParticleField onResolved={(webgpu) => setIsFallback(!webgpu)} />
      </Canvas>
      {isFallback && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            padding: '8px 12px',
            font: '500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.04em',
            color: '#bcd4ff',
            background: 'rgba(8, 14, 30, 0.6)',
            border: '1px solid rgba(120, 160, 255, 0.25)',
            borderRadius: 8,
            backdropFilter: 'blur(6px)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          WebGPU unavailable — WebGL2 fallback
        </div>
      )}
    </div>
  )
}
