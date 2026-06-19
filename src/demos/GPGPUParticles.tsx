import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import simFragment from '../shaders/gpgpu-sim.frag'
import particlesVertex from '../shaders/particles.vert'
import particlesFragment from '../shaders/particles.frag'

// 256 x 256 = 65,536 particles. State lives entirely on the GPU in float
// render targets that are ping-ponged each frame; the CPU never touches a
// single particle position after seeding.
const SIZE = 256
const COUNT = SIZE * SIZE
const RADIUS = 4.5

// Fullscreen-quad vertex shader for the simulation pass. The plane spans
// clip space directly so the camera is irrelevant.
const simVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

// Initial state: particles scattered uniformly inside a sphere, each with a
// randomized life so respawns desynchronize from the start.
function makeSeedTexture(): THREE.DataTexture {
  const data = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    const u = Math.random()
    const v = Math.random()
    const w = Math.random()
    const theta = u * Math.PI * 2
    const phi = Math.acos(2 * v - 1)
    const r = Math.cbrt(w) * (RADIUS * 0.5)
    const i4 = i * 4
    data[i4 + 0] = r * Math.sin(phi) * Math.cos(theta)
    data[i4 + 1] = r * Math.sin(phi) * Math.sin(theta)
    data[i4 + 2] = r * Math.cos(phi)
    data[i4 + 3] = 1.0 + Math.random() * 1.5
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return tex
}

function ParticleSystem() {
  const { gl } = useThree()

  const prefersReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const seed = useMemo(makeSeedTexture, [])

  // Two float targets, no depth/stencil, nearest sampling so texel lookups
  // are exact (no interpolation between neighbouring particles).
  const fboSettings = {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  } as const
  const fboA = useFBO(SIZE, SIZE, fboSettings)
  const fboB = useFBO(SIZE, SIZE, fboSettings)

  const read = useRef<THREE.WebGLRenderTarget>(fboA)
  const write = useRef<THREE.WebGLRenderTarget>(fboB)
  const frame = useRef(0)
  const groupRef = useRef<THREE.Group>(null)

  // Simulation material — reads previous state, writes integrated next state.
  const simMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: simVertex,
        fragmentShader: simFragment,
        uniforms: {
          uPositions: { value: seed as THREE.Texture },
          uTime: { value: 0 },
          uDelta: { value: 0 },
          uNoiseScale: { value: 0.3 },
          uSpeed: { value: 1.0 },
          uAttraction: { value: 0.05 },
          uRadius: { value: RADIUS },
        },
      }),
    [seed],
  )

  // Offscreen scene + ortho camera dedicated to the sim pass.
  const { simScene, simCamera } = useMemo(() => {
    const scene = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial)
    quad.frustumCulled = false
    scene.add(quad)
    return { simScene: scene, simCamera: cam }
  }, [simMaterial])

  // Point cloud geometry. The `position` attribute is a placeholder for a sane
  // bounding sphere; the real position is fetched in the vertex shader from the
  // sim texture via the per-vertex `aRef` texel coordinate.
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(COUNT * 3)
    const refs = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i++) {
      const x = i % SIZE
      const y = Math.floor(i / SIZE)
      refs[i * 2 + 0] = (x + 0.5) / SIZE
      refs[i * 2 + 1] = (y + 0.5) / SIZE
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RADIUS * 2)
    return g
  }, [])

  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: particlesVertex,
        fragmentShader: particlesFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPositions: { value: null as THREE.Texture | null },
          uPointSize: { value: 3.4 },
          uRadius: { value: RADIUS },
          uDpr: { value: 1 },
          uColorCore: { value: new THREE.Color('#ffe7b3') },
          uColorMid: { value: new THREE.Color('#6f9bff') },
          uColorEdge: { value: new THREE.Color('#3a1d6e') },
        },
      }),
    [],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30) * (prefersReduced ? 0.3 : 1)
    const t = state.clock.elapsedTime

    // ---- GPGPU simulation pass (ping-pong) ----
    simMaterial.uniforms.uPositions.value =
      frame.current === 0 ? seed : read.current.texture
    simMaterial.uniforms.uTime.value = t
    simMaterial.uniforms.uDelta.value = dt

    gl.setRenderTarget(write.current)
    gl.render(simScene, simCamera)
    gl.setRenderTarget(null)

    // Render pass reads the freshly written texture.
    pointsMaterial.uniforms.uPositions.value = write.current.texture
    pointsMaterial.uniforms.uDpr.value = gl.getPixelRatio()

    // Swap targets for next frame.
    const tmp = read.current
    read.current = write.current
    write.current = tmp
    frame.current += 1

    // Slow cinematic drift of the whole cloud.
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * (prefersReduced ? 0.012 : 0.06)
      groupRef.current.rotation.x = Math.sin(t * 0.07) * 0.12
    }
  })

  return (
    <group ref={groupRef}>
      <points geometry={geometry} material={pointsMaterial} frustumCulled={false} />
    </group>
  )
}

export default function GPGPUParticles() {
  return (
    <div style={{ width: '100%', height: '100vh', background: '#04050a' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 6.5], fov: 50, near: 0.1, far: 100 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#04050a']} />
        <ParticleSystem />
      </Canvas>
    </div>
  )
}
