import * as THREE from 'three'
import { forwardRef, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import {
  EffectComposer,
  Bloom,
  DepthOfField,
  N8AO,
  Vignette,
  ChromaticAberration,
  Noise,
  SMAA,
} from '@react-three/postprocessing'
import { Effect, BlendFunction } from 'postprocessing'
import gradeFragment from '../shaders/grade.frag'

/* ------------------------------------------------------------------ *
 * Custom hand-written color-grade Effect
 * ------------------------------------------------------------------ *
 * Subclasses postprocessing's `Effect` and drives a GLSL fragment that
 * applies a filmic lift/gamma/gain primary grade plus a teal-orange
 * split-tone. Strictly typed — every uniform value carries a concrete
 * THREE type, no `any`.
 * ------------------------------------------------------------------ */

interface GradeUniforms {
  lift: THREE.Vector3
  gamma: THREE.Vector3
  gain: THREE.Vector3
  shadowTint: THREE.Vector3
  highlightTint: THREE.Vector3
  split: number
  contrast: number
  saturation: number
  intensity: number
}

const GRADE_DEFAULTS: GradeUniforms = {
  // Cool, slightly lifted shadows; warm, gently rolled highlights.
  lift: new THREE.Vector3(0.015, 0.025, 0.05),
  gamma: new THREE.Vector3(0.96, 1.0, 1.06),
  gain: new THREE.Vector3(1.07, 1.02, 0.95),
  // Teal shadows / orange highlights (classic blockbuster split-tone).
  shadowTint: new THREE.Vector3(0.28, 0.55, 0.62),
  highlightTint: new THREE.Vector3(0.64, 0.5, 0.32),
  split: 0.42,
  contrast: 1.14,
  saturation: 1.12,
  intensity: 0.92,
}

class GradeEffect extends Effect {
  constructor(values: GradeUniforms = GRADE_DEFAULTS) {
    super('GradeEffect', gradeFragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uLift', new THREE.Uniform(values.lift)],
        ['uGamma', new THREE.Uniform(values.gamma)],
        ['uGain', new THREE.Uniform(values.gain)],
        ['uShadowTint', new THREE.Uniform(values.shadowTint)],
        ['uHighlightTint', new THREE.Uniform(values.highlightTint)],
        ['uSplit', new THREE.Uniform(values.split)],
        ['uContrast', new THREE.Uniform(values.contrast)],
        ['uSaturation', new THREE.Uniform(values.saturation)],
        ['uIntensity', new THREE.Uniform(values.intensity)],
      ]),
    })
  }
}

// R3F primitive wrapper for the custom Effect. EffectComposer collects the
// underlying Effect instance from the rendered <primitive>. The grade is
// static here, so the effect is built exactly once.
const Grade = forwardRef<GradeEffect>(function Grade(_props, ref) {
  const effect = useMemo(() => new GradeEffect(), [])
  return <primitive ref={ref} object={effect} dispose={null} />
})

/* ------------------------------------------------------------------ *
 * The still-life
 * ------------------------------------------------------------------ */

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function StillLife() {
  const heroRef = useRef<THREE.Mesh>(null)
  const orbRef = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const t = useRef(0)

  useFrame((_state, delta) => {
    // Clamp delta so a stalled tab can't fling the camera.
    const dt = Math.min(delta, 0.05)
    t.current += REDUCED ? 0 : dt

    // Slow cinematic orbit framed on the hero at the origin.
    const angle = t.current * 0.14 + Math.PI * 0.25
    const radius = 6.6
    camera.position.set(
      Math.sin(angle) * radius,
      1.25 + Math.sin(t.current * 0.4) * 0.25,
      Math.cos(angle) * radius,
    )
    camera.lookAt(0, 0.1, 0)

    if (heroRef.current) heroRef.current.rotation.y += dt * 0.3
    if (orbRef.current) {
      orbRef.current.position.x = Math.sin(t.current * 0.7) * 2.4
      orbRef.current.position.z = Math.cos(t.current * 0.7) * 2.4
    }
  })

  return (
    <group>
      {/* Hero — iridescent clearcoat torus knot. */}
      <mesh ref={heroRef} castShadow receiveShadow position={[0, 0.1, 0]}>
        <torusKnotGeometry args={[1, 0.32, 240, 36, 2, 3]} />
        <meshPhysicalMaterial
          color="#1b2330"
          metalness={1}
          roughness={0.16}
          clearcoat={1}
          clearcoatRoughness={0.08}
          iridescence={1}
          iridescenceIOR={1.35}
          envMapIntensity={1.4}
        />
      </mesh>

      {/* Glass sphere — transmissive, refracts the environment. */}
      <mesh castShadow position={[-2.6, -0.35, 0.6]}>
        <sphereGeometry args={[0.85, 64, 64]} />
        <meshPhysicalMaterial
          color="#ffffff"
          metalness={0}
          roughness={0.05}
          transmission={1}
          thickness={1.2}
          ior={1.5}
          clearcoat={1}
          clearcoatRoughness={0.05}
          envMapIntensity={1.5}
        />
      </mesh>

      {/* Brushed gold sphere. */}
      <mesh castShadow receiveShadow position={[2.5, -0.55, -0.4]}>
        <sphereGeometry args={[0.7, 64, 64]} />
        <meshPhysicalMaterial
          color="#c9962f"
          metalness={1}
          roughness={0.32}
          clearcoat={0.6}
          clearcoatRoughness={0.3}
          envMapIntensity={1.2}
        />
      </mesh>

      {/* Emissive orbiting accent — drives the bloom. toneMapped off so the
          raw emissive value blows past 1.0 into the bloom pass. */}
      <mesh ref={orbRef} position={[2.4, 0.9, 0]}>
        <sphereGeometry args={[0.28, 48, 48]} />
        <meshStandardMaterial
          color="#ff5e3a"
          emissive="#ff7a45"
          emissiveIntensity={6}
          toneMapped={false}
        />
      </mesh>

      {/* Subtle reflective ground. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.45, 0]}
        receiveShadow
      >
        <circleGeometry args={[14, 96]} />
        <meshPhysicalMaterial
          color="#0a0c12"
          metalness={0.55}
          roughness={0.42}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
          envMapIntensity={0.6}
        />
      </mesh>

      {/* Key light with soft contact shadows. */}
      <directionalLight
        castShadow
        position={[5, 7, 4]}
        intensity={2.6}
        color="#fff2e0"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-8, 8, 8, -8, 0.5, 30]}
        />
      </directionalLight>
      <ambientLight intensity={0.12} />

      {/* HDRI-less, fully self-contained studio environment baked once from
          in-scene light cards — no network fetch, ready within one frame. */}
      <Environment resolution={256} frames={1} environmentIntensity={1}>
        <color attach="background" args={['#05060a']} />
        <Lightformer
          form="rect"
          intensity={4}
          position={[0, 5, -6]}
          scale={[12, 6, 1]}
          color="#fff3e0"
        />
        <Lightformer
          form="rect"
          intensity={2.4}
          position={[-6, 2, 2]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[10, 5, 1]}
          color="#6fb6ff"
        />
        <Lightformer
          form="ring"
          intensity={2.2}
          position={[6, 3, 3]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[6, 6, 1]}
          color="#ffc48a"
        />
        <Lightformer
          form="circle"
          intensity={1.6}
          position={[0, -4, 2]}
          scale={[8, 8, 1]}
          color="#243047"
        />
      </Environment>
    </group>
  )
}

/* ------------------------------------------------------------------ *
 * Stacked, capped post pipeline + wrapper
 * ------------------------------------------------------------------ */

export default function CinematicPostFX() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05060a' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [4.6, 1.3, 4.6], fov: 42, near: 0.1, far: 100 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.1, 0)}
      >
        <color attach="background" args={['#05060a']} />
        <fog attach="fog" args={['#05060a', 9, 22]} />

        <StillLife />

        {/* multisampling 0 → SMAA owns anti-aliasing; sample counts capped for 60fps. */}
        <EffectComposer multisampling={0}>
          <N8AO
            aoRadius={1.1}
            distanceFalloff={1}
            intensity={2.2}
            quality="low"
            aoSamples={8}
            denoiseSamples={4}
            denoiseRadius={6}
            halfRes
            color="#02030a"
          />
          <DepthOfField
            target={[0, 0.1, 0]}
            focalLength={0.018}
            focusRange={0.012}
            bokehScale={3.2}
            resolutionScale={0.75}
          />
          <Bloom
            mipmapBlur
            intensity={0.9}
            luminanceThreshold={0.85}
            luminanceSmoothing={0.25}
            radius={0.7}
          />
          <ChromaticAberration
            offset={new THREE.Vector2(0.0009, 0.0012)}
            radialModulation
            modulationOffset={0.35}
          />
          <Grade />
          <Vignette offset={0.28} darkness={0.85} />
          <Noise opacity={REDUCED ? 0.025 : 0.06} premultiply />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
