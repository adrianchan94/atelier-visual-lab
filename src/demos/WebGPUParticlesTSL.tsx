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

// ~160k particles forming a luminous, pointer-reactive nebula. Position +
// velocity live entirely in GPU storage buffers; the CPU only seeds them once.
// On a WebGPU backend a TSL compute kernel advects every particle by a
// divergence-free curl-noise flow, a centering force, and an attraction toward
// the pointer each frame. On a WebGL2 backend (no compute) the same field is
// reconstructed analytically inside the position node — so it still moves and
// reacts, fully validated headless. Both paths are 100% TSL / NodeMaterial:
// one node graph, compiled to WGSL (WebGPU) and GLSL (WebGL2).
const COUNT = 160_000
const SEED_RADIUS = 8

type FloatUniform = UniformNode<'float', number>
type Vec3Uniform = UniformNode<'vec3', THREE.Vector3>

// Reused scratch — the pointer is unprojected onto the z=0 plane each frame
// without allocating in useFrame.
const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _hit = new THREE.Vector3()

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

// Galaxy palette: teal core -> violet midfield -> gold on the fastest streaks,
// boosted by speed so additive blending makes the hot motion glow.
function fieldColor(posN: Node<'vec3'>, speedN: Node<'float'>): Node<'vec3'> {
  const radial = posN.length().mul(0.1).clamp(0, 1)
  const teal = vec3(0.1, 0.6, 0.92)
  const violet = vec3(0.55, 0.2, 0.95)
  const gold = vec3(1.0, 0.78, 0.38)
  const baseCol = mix(teal, violet, radial)
  const col = mix(baseCol, gold, speedN.mul(0.5).clamp(0, 1))
  return col.mul(speedN.mul(0.6).add(0.55)).mul(1.5)
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
  const camera = useThree((s) => s.camera)
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

  // Animation clocks + pointer attractor shared by both code paths. We feed an
  // explicit, clamped step from useFrame rather than relying on TSL's built-in
  // deltaTime (its cross-backend timing is subtle).
  const uTime = useMemo<FloatUniform>(() => uniform(0), [])
  const uStep = useMemo<FloatUniform>(() => uniform(0.016), [])
  const uScale = useMemo<FloatUniform>(() => uniform(0.07), [])
  const uPointer = useMemo<Vec3Uniform>(
    () => uniform(new THREE.Vector3(0, 0, 0)),
    [],
  )

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

        const fieldP = pos.mul(0.15).add(vec3(0, uTime.mul(0.12), 0))
        const flow = curlNoise(fieldP)

        // Pointer attraction with inverse-distance falloff (a gentle vortex).
        const toPointer = uPointer.sub(pos)
        const dist = toPointer.length().add(0.4)
        const pull = toPointer.div(dist).mul(float(6.0).div(dist))

        const accel = flow.mul(2.6).add(pull).sub(pos.mul(0.35))
        vel.addAssign(accel.mul(uStep))
        vel.mulAssign(0.94)
        pos.addAssign(vel.mul(uStep))
      })().compute(COUNT)

      const positionNode = positionStorage.toAttribute()
      const colorNode = fieldColor(
        positionStorage.toAttribute(),
        velocityStorage.toAttribute().length(),
      )
      return { positionNode, colorNode, compute: computeUpdate }
    }

    // WebGL2 fallback: no compute. Reconstruct a flowing, pointer-reactive
    // field analytically in the position node, indexed per-instance.
    const id = float(instanceIndex)
    const seed = vec3(
      id.mul(0.0123),
      id.mul(0.0071).add(11.3),
      id.mul(0.0177).add(31.7),
    )
    const base = mx_noise_vec3(seed).mul(SEED_RADIUS)
    const fieldP = base.mul(0.15).add(vec3(0, uTime.mul(0.12), 0))
    const flow = curlNoise(fieldP)

    const toPointer = uPointer.sub(base)
    const d = toPointer.length().add(0.6)
    const pull = toPointer.div(d).mul(float(2.6).div(d))

    const positionNode = base.add(flow.mul(1.4)).add(pull)
    const colorNode = fieldColor(positionNode, flow.length())
    return { positionNode, colorNode, compute: null }
  }, [buffers, useCompute, uTime, uStep, uPointer])

  // Instanced billboard sprites. positionNode overrides the per-instance
  // center; the plane corners expand around it in view space (sizeAttenuation).
  const mesh = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new SpriteNodeMaterial()
    material.positionNode = nodes.positionNode
    material.colorNode = nodes.colorNode
    material.scaleNode = uScale

    // Soft circular falloff so each sprite reads as a glowing point.
    const dd = uv().sub(vec2(0.5, 0.5)).length()
    material.opacityNode = smoothstep(0.0, 0.5, dd).oneMinus().mul(0.5)

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

  useFrame((state, delta) => {
    const step = Math.min(delta, 1 / 30) * speedScale
    uStep.value = step
    uTime.value += step

    // Unproject the pointer onto the z=0 plane for a world-space attractor.
    _ndc.set(state.pointer.x, state.pointer.y)
    _ray.setFromCamera(_ndc, camera)
    if (_ray.ray.intersectPlane(_plane, _hit)) {
      uPointer.value.lerp(_hit, prefersReduced ? 1 : Math.min(1, delta * 4))
    }

    const group = meshRef.current
    if (group) group.rotation.y += delta * 0.05 * speedScale

    if (nodes.compute) {
      void renderer.compute(nodes.compute)
    }
  })

  return <primitive ref={meshRef} object={mesh} />
}

export default function WebGPUParticlesTSL() {
  const supportsWebGPU = useMemo(
    () => typeof navigator !== 'undefined' && !!navigator.gpu,
    [],
  )
  const [isWebGPU, setIsWebGPU] = useState(supportsWebGPU)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#03040c' }}>
      <Canvas
        dpr={[1, 2]}
        gl={async (defaultProps) => {
          // `defaultProps` is R3F's DefaultGLProps; structurally compatible
          // with WebGPURendererParameters but TS can't unify the two renderer
          // param shapes, so assert once at this construction boundary.
          const params = defaultProps as unknown as WebGPURendererParameters
          const renderer = new WebGPURenderer({
            ...params,
            forceWebGL: !supportsWebGPU,
          })
          await renderer.init()
          return renderer
        }}
        camera={{ position: [0, 0, 18], fov: 55, near: 0.1, far: 120 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#03040c']} />
        <ParticleField onResolved={setIsWebGPU} />
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>WEBGPU · TSL PARTICLES</span>
        <span style={ui.pill}>{isWebGPU ? 'WEBGPU' : 'WEBGL2'}</span>
        <span style={ui.note}>compute curl-flow · move pointer to pull</span>
        <a href="?" style={ui.back}>
          ← index
        </a>
      </div>
    </div>
  )
}

const ui: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#9ab8ff' },
  pill: {
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.12em',
    color: '#eaf0ff',
    fontSize: 12,
    background: 'rgba(16,22,46,0.7)',
    border: '1px solid #2b3a6e',
    borderRadius: 999,
    padding: '5px 12px',
    backdropFilter: 'blur(8px)',
  },
  note: { color: '#7c8bbe', fontSize: 12 },
  back: { color: '#a0b8ff', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
