import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { XR, createXRStore } from '@react-three/xr'
import * as THREE from 'three'

/**
 * Spatial scene — the webxr-spatial skill made literal.
 *
 * A WebXR-ready hall: wrapped in `@react-three/xr` v6 `<XR store>`, it runs as a
 * normal orbitable 3D scene on a flat screen and becomes immersive on a headset
 * / Vision Pro via `store.enterVR()` / `store.enterAR()` (gaze-and-pinch =
 * transient-pointer on visionOS). The flat-screen fallback is what's validated
 * here; the same tree drops into VR/AR with no scene changes.
 */

const store = createXRStore()

const PILLARS = 8
const RADIUS = 3.2

function Hall() {
  const ring = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (ring.current) ring.current.rotation.y += delta * 0.12
    if (core.current) {
      core.current.rotation.x += delta * 0.25
      core.current.rotation.y += delta * 0.35
      core.current.position.y = 1.4 + Math.sin(state.clock.elapsedTime * 0.8) * 0.18
    }
  })

  return (
    <group>
      {/* Central beacon */}
      <mesh ref={core} position={[0, 1.4, 0]}>
        <torusKnotGeometry args={[0.42, 0.14, 180, 28]} />
        <meshStandardMaterial
          color="#1a0e2e"
          emissive="#9d6bff"
          emissiveIntensity={2.0}
          metalness={0.4}
          roughness={0.2}
        />
      </mesh>

      {/* Ring of emissive pillars */}
      <group ref={ring}>
        {Array.from({ length: PILLARS }, (_, i) => {
          const a = (i / PILLARS) * Math.PI * 2
          const col = new THREE.Color().setHSL(i / PILLARS, 0.7, 0.55)
          return (
            <group key={i} position={[Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS]}>
              <mesh position={[0, 1.1, 0]}>
                <boxGeometry args={[0.4, 2.2, 0.4]} />
                <meshStandardMaterial
                  color="#0c0c16"
                  emissive={col}
                  emissiveIntensity={0.9}
                  metalness={0.5}
                  roughness={0.3}
                />
              </mesh>
              <pointLight position={[0, 2.0, 0]} color={col} intensity={4} distance={6} decay={2} />
            </group>
          )
        })}
      </group>

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[7, 64]} />
        <meshStandardMaterial color="#0a0a12" metalness={0.75} roughness={0.4} />
      </mesh>

      {/* Subtle grid ring for spatial reference */}
      <gridHelper args={[14, 28, '#2a2a44', '#16162a']} position={[0, 0.01, 0]} />

      <ambientLight intensity={0.18} />
      <hemisphereLight args={['#9fb4ff', '#0a0810', 0.4]} />
      <directionalLight position={[4, 6, 3]} intensity={0.8} />
    </group>
  )
}

export default function SpatialScene() {
  const [vrOk, setVrOk] = useState(false)
  const [arOk, setArOk] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const xr = navigator.xr
    if (!xr) {
      setMsg('WebXR not available in this browser — flat-screen fallback')
      return
    }
    xr.isSessionSupported('immersive-vr').then(setVrOk).catch(() => setVrOk(false))
    xr.isSessionSupported('immersive-ar').then(setArOk).catch(() => setArOk(false))
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050510' }}>
      <Canvas camera={{ position: [0, 2.0, 6.2], fov: 55 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#050510']} />
        <fog attach="fog" args={['#050510', 9, 22]} />
        <XR store={store}>
          <Hall />
          <OrbitControls
            target={[0, 1.2, 0]}
            enablePan={false}
            autoRotate
            autoRotateSpeed={0.5}
            minDistance={3}
            maxDistance={14}
          />
        </XR>
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>SPATIAL · WEBXR</span>
        <button
          style={vrOk ? ui.btn : ui.btnOff}
          onClick={() => {
            store.enterVR().catch(() => setMsg('VR session failed'))
          }}
        >
          {vrOk ? '🥽 Enter VR' : 'VR unavailable'}
        </button>
        <button
          style={arOk ? ui.btn : ui.btnOff}
          onClick={() => {
            store.enterAR().catch(() => setMsg('AR session failed'))
          }}
        >
          {arOk ? '👓 Enter AR' : 'AR unavailable'}
        </button>
        <a href="?" style={ui.back}>
          ← index
        </a>
      </div>
      {msg && <div style={ui.note}>{msg}</div>}
    </div>
  )
}

const ui: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#9d8aff' },
  btn: {
    background: 'rgba(20,16,40,0.7)',
    color: '#e6e0ff',
    border: '1px solid #3a2c5a',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  btnOff: {
    background: 'rgba(18,18,24,0.6)',
    color: '#6a6a80',
    border: '1px solid #24242e',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'not-allowed',
    fontSize: 13,
  },
  note: {
    position: 'fixed',
    left: 16,
    bottom: 58,
    color: '#8a8aa0',
    fontSize: 12,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    maxWidth: '76vw',
  },
  back: { color: '#b0a0e0', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
