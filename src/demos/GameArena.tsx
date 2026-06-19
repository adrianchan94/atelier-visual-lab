import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { RapierRigidBody, InstancedRigidBodyProps } from '@react-three/rapier'
import { useCallback, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  Physics,
  RigidBody,
  CuboidCollider,
  InstancedRigidBodies,
} from '@react-three/rapier'

// ── Tuning ──────────────────────────────────────────────────────────────
// A single InstancedRigidBodies drives every sphere through ONE instancedMesh
// (one draw call). The CPU never sets a per-frame matrix — Rapier writes the
// instance matrices imperatively each physics step. We only read translations
// (for recycling) and apply impulses (on click).
const BOWL_RADIUS = 7.5 // inner radius of the walled arena
const WALL_HEIGHT = 5
const WALL_SEGMENTS = 20 // cuboid segments approximating a circular wall
const BALL_RADIUS = 0.34
const FALL_FLOOR = -14 // recycle anything that drops below this
const SPAWN_TOP = 16 // height bodies rain in from
const BLAST_RADIUS = 5.5
// Ball mass ≈ 0.165 (r=0.34, density 1); impulse ≈ mass·Δv, so ~3 gives a
// punchy ~18 m/s scatter at the epicenter that mostly stays inside the bowl.
const BLAST_STRENGTH = 3

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const COUNT = prefersReducedMotion ? 140 : 320

// Reusable scratch vectors — zero allocation inside useFrame / handlers.
const _tmp = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _color = new THREE.Color()

// Tints each body's emissive glow by its per-instance color. Three populates
// `vColor` from `instanceColor` (USE_INSTANCING_COLOR) and bakes
// emissiveIntensity into the `emissive` uniform, so multiplying gives a
// correctly-scaled, per-instance colored glow — without a bespoke material.
const EMISSIVE_WHITE = new THREE.Color('#ffffff')
function colorEmissiveByInstance(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec3 totalEmissiveRadiance = emissive;',
    'vec3 totalEmissiveRadiance = emissive * vColor;',
  )
}

// A random point inside the spawn column above the bowl.
function spawnPoint(target: THREE.Vector3): THREE.Vector3 {
  const r = Math.sqrt(Math.random()) * (BOWL_RADIUS - BALL_RADIUS * 2)
  const a = Math.random() * Math.PI * 2
  target.set(
    Math.cos(a) * r,
    SPAWN_TOP + Math.random() * 10,
    Math.sin(a) * r,
  )
  return target
}

// ── Bodies ──────────────────────────────────────────────────────────────
function Bodies() {
  const bodiesRef = useRef<(RapierRigidBody | null)[]>(null)

  // Initial transforms + a stable color per instance, computed once.
  const { instances, colors } = useMemo(() => {
    const list: InstancedRigidBodyProps[] = []
    const cols = new Float32Array(COUNT * 3)
    const v = new THREE.Vector3()
    const c = new THREE.Color()
    for (let i = 0; i < COUNT; i++) {
      spawnPoint(v)
      list.push({
        key: i,
        position: [v.x, v.y, v.z],
        rotation: [Math.random() * Math.PI, Math.random() * Math.PI, 0],
      })
      // Vivid emissive palette: cycle hue, high saturation, bright.
      c.setHSL((i / COUNT) * 0.85 + 0.02, 0.85, 0.55)
      cols[i * 3 + 0] = c.r
      cols[i * 3 + 1] = c.g
      cols[i * 3 + 2] = c.b
    }
    return { instances: list, colors: cols }
  }, [])

  // Callback ref: fires during React commit, BEFORE R3F's rAF render loop, so
  // `instanceColor` exists before the material's first compile. That guarantees
  // three defines USE_INSTANCING_COLOR (hence `vColor`) so the emissive patch
  // is valid. setColorAt lazily allocates the instanceColor attribute.
  const setMesh = useCallback(
    (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return
      for (let i = 0; i < COUNT; i++) {
        _color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])
        mesh.setColorAt(i, _color)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    [colors],
  )

  // Radial blast from a world-space point — pushes nearby bodies outward + up.
  const explode = (center: THREE.Vector3) => {
    const bodies = bodiesRef.current
    if (!bodies) return
    for (const body of bodies) {
      if (!body) continue
      const t = body.translation()
      _dir.set(t.x - center.x, t.y - center.y, t.z - center.z)
      const dist = _dir.length()
      if (dist > BLAST_RADIUS) continue
      const falloff = 1 - dist / BLAST_RADIUS
      // Normalize (guard divide-by-zero at the epicenter) and bias upward.
      if (dist > 1e-4) _dir.multiplyScalar(1 / dist)
      else _dir.set(0, 1, 0)
      const mag = BLAST_STRENGTH * falloff * falloff
      body.applyImpulse(
        { x: _dir.x * mag, y: _dir.y * mag + mag * 0.35, z: _dir.z * mag },
        true,
      )
    }
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    explode(e.point)
  }

  // Recycle bodies that escape the arena so the scene never empties.
  useFrame(() => {
    const bodies = bodiesRef.current
    if (!bodies) return
    for (const body of bodies) {
      if (!body) continue
      const t = body.translation()
      if (t.y < FALL_FLOOR) {
        spawnPoint(_tmp)
        body.setTranslation({ x: _tmp.x, y: _tmp.y, z: _tmp.z }, true)
        body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        body.setAngvel(
          { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 },
          true,
        )
      }
    }
  })

  return (
    <>
      {/* Transparent catcher so clicks on bare floor between bodies also blast.
          Bodies sit above it, so the raycaster hits a body first when present. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} onClick={handleClick}>
        <circleGeometry args={[BOWL_RADIUS, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      colliders="ball"
      restitution={0.4}
      friction={0.6}
      linearDamping={0.05}
      angularDamping={0.15}
    >
      <instancedMesh
        ref={setMesh}
        args={[undefined, undefined, COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onClick={handleClick}
      >
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <meshStandardMaterial
          metalness={0.25}
          roughness={0.35}
          emissive={EMISSIVE_WHITE}
          emissiveIntensity={0.55}
          toneMapped
          onBeforeCompile={colorEmissiveByInstance}
        />
      </instancedMesh>
      </InstancedRigidBodies>
    </>
  )
}

// ── Arena: fixed floor + ring of wall segments forming a circular bowl ────
function Arena() {
  const segments = useMemo(() => {
    const out: { position: [number, number, number]; rotation: [number, number, number]; halfWidth: number }[] = []
    const halfWidth = BOWL_RADIUS * Math.tan(Math.PI / WALL_SEGMENTS) * 1.05
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2
      out.push({
        position: [Math.cos(a) * BOWL_RADIUS, WALL_HEIGHT / 2, Math.sin(a) * BOWL_RADIUS],
        rotation: [0, -a, 0],
        halfWidth,
      })
    }
    return out
  }, [])

  return (
    <RigidBody type="fixed" colliders={false} restitution={0.3} friction={0.8}>
      {/* Physics floor */}
      <CuboidCollider args={[BOWL_RADIUS + 1, 0.5, BOWL_RADIUS + 1]} position={[0, -0.5, 0]} />
      {/* Physics walls */}
      {segments.map((s, i) => (
        <CuboidCollider
          key={i}
          args={[s.halfWidth, WALL_HEIGHT / 2, 0.3]}
          position={s.position}
          rotation={s.rotation}
        />
      ))}

      {/* Visible floor disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[BOWL_RADIUS + 0.6, 64]} />
        <meshStandardMaterial color="#0b0d16" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Visible wall ring (open cylinder) */}
      <mesh position={[0, WALL_HEIGHT / 2, 0]} receiveShadow>
        <cylinderGeometry
          args={[BOWL_RADIUS + 0.3, BOWL_RADIUS + 0.3, WALL_HEIGHT, 64, 1, true]}
        />
        <meshStandardMaterial
          color="#11131f"
          metalness={0.5}
          roughness={0.55}
          side={THREE.BackSide}
          transparent
          opacity={0.55}
        />
      </mesh>
    </RigidBody>
  )
}

// ── Moving point light for drama ──────────────────────────────────────────
function OrbitingLight() {
  const ref = useRef<THREE.PointLight>(null)
  useFrame((state) => {
    const l = ref.current
    if (!l) return
    const t = prefersReducedMotion ? 1.2 : state.clock.elapsedTime
    l.position.set(Math.cos(t * 0.6) * 6, 7 + Math.sin(t * 0.9) * 1.5, Math.sin(t * 0.6) * 6)
    _color.setHSL((Math.sin(t * 0.2) * 0.5 + 0.5) * 0.7 + 0.05, 0.7, 0.55)
    l.color.copy(_color)
  })
  return <pointLight ref={ref} intensity={120} distance={40} decay={2} castShadow={false} />
}

export default function GameArena() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 50% 30%, #1a1f33 0%, #05060c 70%)' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 13, 17], fov: 50 }}
      >
        <color attach="background" args={['#05060c']} />
        <fog attach="fog" args={['#05060c', 22, 48]} />

        <ambientLight intensity={0.35} />
        <hemisphereLight args={['#5a6cff', '#0a0a12', 0.5]} />
        <directionalLight
          position={[8, 18, 6]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-camera-near={1}
          shadow-camera-far={50}
        />
        <OrbitingLight />

        <Physics gravity={[0, -22, 0]} timeStep="vary">
          <Arena />
          <Bodies />
        </Physics>

        <OrbitControls
          target={[0, 1.5, 0]}
          enablePan={false}
          minDistance={9}
          maxDistance={34}
          maxPolarAngle={Math.PI * 0.49}
        />
      </Canvas>
    </div>
  )
}
