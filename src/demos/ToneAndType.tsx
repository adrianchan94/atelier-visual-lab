import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Center, Text3D, OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'

/**
 * Tone & Type — the cinematic-postfx (AgX/Neutral) + elite-web-typography
 * (in-scene 3D text) upgrades made literal.
 *
 * An emissive HDR stage (values > 1) is pushed through a bloom pass, then the
 * tonemapping operator is switched live: AgX (filmic, gentle highlight
 * desaturation — now the three.js default-of-choice), Khronos PBR **Neutral**
 * (hue-preserving, the e-commerce pick), ACES Filmic (punchy, legacy default),
 * and None (clipped, to show why tonemapping matters). The headline is real
 * in-scene geometry via drei `<Text3D>` (offline helvetiker typeface, no CDN
 * font fetch).
 */

type Tone = 'AgX' | 'Neutral' | 'ACES' | 'None'

const TONE_MAP: Record<Tone, THREE.ToneMapping> = {
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  None: THREE.NoToneMapping,
}

const TONE_NOTE: Record<Tone, string> = {
  AgX: 'filmic, gentle highlight roll-off — desaturates as it clips',
  Neutral: 'Khronos PBR Neutral — preserves hue/saturation (product/e-comm)',
  ACES: 'punchy contrast, slight hue shift — the legacy default',
  None: 'no operator — highlights clip hard to white',
}

// Applies the operator live and recompiles materials (toneMapping is a shader
// define, so changing renderer.toneMapping needs material.needsUpdate).
function ToneController({ tone }: { tone: Tone }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    gl.toneMapping = TONE_MAP[tone]
    gl.toneMappingExposure = 1.0
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material
        if (Array.isArray(m)) for (const mm of m) mm.needsUpdate = true
        else if (m) m.needsUpdate = true
      }
    })
  }, [tone, gl, scene])
  return null
}

const SPHERES = 7

function Stage() {
  const ring = useRef<THREE.Group>(null)
  const knot = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (ring.current) ring.current.rotation.y += delta * 0.25
    if (knot.current) {
      knot.current.rotation.x += delta * 0.2
      knot.current.rotation.y += delta * 0.3
      const m = knot.current.material
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissiveIntensity = 2.2 + Math.sin(state.clock.elapsedTime * 1.3) * 0.8
      }
    }
  })

  return (
    <group>
      {/* Emissive headline */}
      <Center position={[0, 0.9, 0]}>
        <Text3D
          font="/helvetiker_regular.typeface.json"
          size={1.05}
          height={0.28}
          bevelEnabled
          bevelThickness={0.04}
          bevelSize={0.025}
          bevelSegments={4}
          curveSegments={8}
          letterSpacing={-0.04}
        >
          AGX
          <meshStandardMaterial
            color="#fff4e6"
            emissive="#ff8a3c"
            emissiveIntensity={1.8}
            metalness={0.5}
            roughness={0.18}
          />
        </Text3D>
      </Center>

      {/* Central emissive knot — the highlight source bloom feeds on */}
      <mesh ref={knot} position={[0, -0.6, -1.4]}>
        <torusKnotGeometry args={[0.7, 0.22, 160, 24]} />
        <meshStandardMaterial
          color="#220033"
          emissive="#7c4dff"
          emissiveIntensity={2.4}
          metalness={0.3}
          roughness={0.25}
        />
      </mesh>

      {/* Orbiting emissive spheres at varied HDR intensities */}
      <group ref={ring} position={[0, -0.6, -1.4]}>
        {Array.from({ length: SPHERES }, (_, i) => {
          const a = (i / SPHERES) * Math.PI * 2
          const hue = i / SPHERES
          const col = new THREE.Color().setHSL(hue, 0.85, 0.55)
          return (
            <mesh key={i} position={[Math.cos(a) * 2.6, Math.sin(a * 1.5) * 0.5, Math.sin(a) * 2.6]}>
              <sphereGeometry args={[0.24, 32, 32]} />
              <meshStandardMaterial
                color={col}
                emissive={col}
                emissiveIntensity={1.5 + (i % 3)}
                roughness={0.3}
                metalness={0.1}
              />
            </mesh>
          )
        })}
      </group>

      {/* Stage floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.7, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0a0a14" metalness={0.7} roughness={0.35} />
      </mesh>

      <ambientLight intensity={0.12} />
      <pointLight position={[4, 4, 4]} intensity={30} color="#ffd9a0" distance={20} decay={2} />
      <pointLight position={[-5, 1, 2]} intensity={20} color="#5b78ff" distance={20} decay={2} />
    </group>
  )
}

export default function ToneAndType() {
  const [tone, setTone] = useState<Tone>('AgX')

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050409' }}>
      <Canvas camera={{ position: [0, 0.4, 6.2], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#050409']} />
        <ToneController tone={tone} />
        <Stage />
        <OrbitControls enablePan={false} minDistance={4} maxDistance={11} />
        <EffectComposer>
          <Bloom intensity={1.3} luminanceThreshold={1.0} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>TONE &amp; TYPE</span>
        {(Object.keys(TONE_MAP) as Tone[]).map((t) => (
          <button key={t} style={t === tone ? ui.btnOn : ui.btn} onClick={() => setTone(t)}>
            {t}
          </button>
        ))}
        <a href="?" style={ui.back}>
          ← index
        </a>
      </div>
      <div style={ui.note}>{TONE_NOTE[tone]}</div>
    </div>
  )
}

const ui: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#f0b27a', marginRight: 4 },
  btn: {
    background: 'rgba(22,16,12,0.7)',
    color: '#f3e2d2',
    border: '1px solid #463524',
    borderRadius: 999,
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  btnOn: {
    background: 'rgba(255,138,60,0.28)',
    color: '#fff',
    border: '1px solid #ff8a3c',
    borderRadius: 999,
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  note: {
    position: 'fixed',
    left: 16,
    bottom: 58,
    color: '#9a8c7c',
    fontSize: 12,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    maxWidth: '70vw',
  },
  back: { color: '#e0b48c', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
