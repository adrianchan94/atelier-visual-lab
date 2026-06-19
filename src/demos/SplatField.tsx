import * as THREE from 'three'
import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Splat, OrbitControls } from '@react-three/drei'

// 3D Gaussian Splatting. The procedural galaxy in /galaxy.splat is streamed
// and sorted by drei's <Splat> (a worker-backed instanced quad renderer); we
// only own framing, a gentle spin, and a parallax starfield for depth.

const STAR_COUNT = 1400
const STAR_INNER = 18
const STAR_OUTER = 60

// A thin additive starfield shell that lives WELL behind the splat so the
// gaussian cloud always reads as the foreground subject. Colors lean cool
// white -> faint blue to match the deep-space backdrop.
function Starfield() {
  const geometry = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3)
    const colors = new Float32Array(STAR_COUNT * 3)
    const color = new THREE.Color()
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform direction on the sphere, radius in a spherical shell.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = STAR_INNER + Math.random() * (STAR_OUTER - STAR_INNER)
      const s = Math.sqrt(1 - u * u)
      positions[i * 3 + 0] = Math.cos(theta) * s * r
      positions[i * 3 + 1] = u * r
      positions[i * 3 + 2] = Math.sin(theta) * s * r

      const t = Math.random()
      color.setHSL(0.6, 0.35 * (1 - t), 0.65 + 0.3 * t)
      colors[i * 3 + 0] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.08,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  const ref = useRef<THREE.Points>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y -= delta * 0.01
  })

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />
}

// Drei's worker stream resolves before the first sorted frame, so a faint
// placeholder occupies the frame while bytes arrive. The starfield already
// renders instantly outside Suspense, but a soft proxy keeps the center alive.
function SplatLoadingProxy() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.4
  })
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[0.9, 1]} />
      <meshBasicMaterial color="#1b2a55" wireframe transparent opacity={0.35} />
    </mesh>
  )
}

function Galaxy() {
  const groupRef = useRef<THREE.Group>(null)

  const prefersReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Splat .ply/.splat assets are typically authored Y-down relative to three's
  // Y-up convention; flip on X so the galaxy sits disc-up, and add a slight
  // tilt for a more cinematic three-quarter read.
  useFrame((_, delta) => {
    if (groupRef.current && !prefersReduced) groupRef.current.rotation.y += delta * 0.08
  })

  return (
    <group ref={groupRef} rotation={[Math.PI, 0.18, 0]}>
      <Splat src="/galaxy.splat" />
    </group>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={['#05060c']} />
      <fog attach="fog" args={['#05060c', 22, 70]} />
      <Starfield />
      <Suspense fallback={<SplatLoadingProxy />}>
        <Galaxy />
      </Suspense>
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.05}
        minDistance={2.5}
        maxDistance={18}
        target={[0, 0, 0]}
      />
    </>
  )
}

export default function SplatField() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05060c' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 1.5, 6], fov: 50, near: 0.1, far: 200 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
