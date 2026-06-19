import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer'

/**
 * Path-traced studio — the realtime-pathtracing skill made literal.
 *
 * A physically-based scene (metal, glass with transmission, clearcoat) lit by a
 * procedural `GradientEquirectTexture` (no CDN HDRI) is rendered with
 * `three-gpu-pathtracer`'s `WebGLPathTracer`: it rasterizes instantly then
 * progressively accumulates true global illumination, soft shadows and
 * reflections. A priority-1 `useFrame` takes over the render loop and calls
 * `renderSample()`; orbiting resets accumulation (damping/auto-rotate are off so
 * the image converges when idle). Sample count is shown live.
 */

function Spheres() {
  return (
    <group>
      {/* polished metal */}
      <mesh position={[-1.5, 0.6, 0]} castShadow>
        <sphereGeometry args={[0.6, 64, 64]} />
        <meshPhysicalMaterial color="#dfe3ee" metalness={1} roughness={0.04} />
      </mesh>
      {/* clear glass (transmission) */}
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.6, 64, 64]} />
        <meshPhysicalMaterial
          color="#ffffff"
          metalness={0}
          roughness={0.02}
          transmission={1}
          thickness={1.2}
          ior={1.5}
        />
      </mesh>
      {/* clearcoat lacquer */}
      <mesh position={[1.5, 0.6, 0]}>
        <sphereGeometry args={[0.6, 64, 64]} />
        <meshPhysicalMaterial
          color="#bf1f3a"
          metalness={0}
          roughness={0.45}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </mesh>
      {/* rough gold accent */}
      <mesh position={[0, 0.35, 1.6]}>
        <sphereGeometry args={[0.35, 48, 48]} />
        <meshPhysicalMaterial color="#ffb24d" metalness={1} roughness={0.35} />
      </mesh>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshPhysicalMaterial color="#15161d" metalness={0} roughness={0.35} />
      </mesh>
    </group>
  )
}

function PathTracer({
  hudRef,
  tracerRef,
}: {
  hudRef: React.RefObject<HTMLSpanElement | null>
  tracerRef: React.RefObject<WebGLPathTracer | null>
}) {
  const { gl, scene, camera, size } = useThree()
  const tracer = useMemo(() => new WebGLPathTracer(gl), [gl])
  tracerRef.current = tracer

  useEffect(() => {
    const env = new GradientEquirectTexture(1024)
    env.topColor.set('#4a6ea8')
    env.bottomColor.set('#efd2a8')
    env.exponent = 2.2
    env.mapping = THREE.EquirectangularReflectionMapping
    env.update()
    scene.environment = env
    scene.background = env

    tracer.renderScale = 0.7
    tracer.bounces = 5
    tracer.transmissiveBounces = 8
    tracer.minSamples = 1
    tracer.fadeDuration = 300
    tracer.setScene(scene, camera)

    return () => {
      tracer.dispose()
      env.dispose()
      scene.environment = null
      scene.background = null
    }
  }, [tracer, scene, camera])

  // (camera resets are driven by OrbitControls' onChange in the parent)

  // Keep camera/render size in sync on resize.
  useEffect(() => {
    tracer.updateCamera()
  }, [tracer, size.width, size.height])

  useFrame(() => {
    tracer.renderSample()
    if (hudRef.current) hudRef.current.textContent = `${Math.floor(tracer.samples)} spp`
  }, 1)

  return null
}

export default function PathTraced() {
  const hudRef = useRef<HTMLSpanElement>(null)
  const tracerRef = useRef<WebGLPathTracer | null>(null)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0b10' }}>
      <Canvas camera={{ position: [0, 1.5, 5], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: false }}>
        <Spheres />
        <OrbitControls
          makeDefault
          target={[0, 0.5, 0]}
          enableDamping={false}
          enablePan={false}
          minDistance={2.5}
          maxDistance={12}
          onChange={() => tracerRef.current?.updateCamera()}
        />
        <PathTracer hudRef={hudRef} tracerRef={tracerRef} />
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>PATH-TRACED</span>
        <span style={ui.spp} ref={hudRef}>
          0 spp
        </span>
        <span style={ui.note}>progressive GI · drag to re-converge</span>
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
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#9ad0c0' },
  spp: {
    fontVariantNumeric: 'tabular-nums',
    color: '#eafff6',
    fontSize: 13,
    background: 'rgba(16,28,24,0.7)',
    border: '1px solid #244038',
    borderRadius: 999,
    padding: '5px 12px',
    backdropFilter: 'blur(8px)',
  },
  note: { color: '#7c9a8e', fontSize: 12 },
  back: { color: '#a0d0c0', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
