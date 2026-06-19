import { useCallback, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'

/**
 * Boids — Reynolds flocking made literal, the webgl-game-architecture +
 * procedural-generation skills fused into one draw call.
 *
 * Thousands of agents are simulated on the CPU each frame (separation /
 * alignment / cohesion + soft box bounds + a pointer attractor) and rendered
 * through a SINGLE `THREE.InstancedMesh` — one geometry, one material, one
 * draw call. Neighbour queries run against a module-level linked-list spatial
 * hash (uniform grid), so the per-frame cost is ~O(n · k) with a hard
 * `NEIGHBOR_CAP`, never O(n²). Every per-instance transform is written via
 * `setMatrixAt`; speed drives a per-instance colour via `setColorAt` that the
 * standard material's emissive term picks up (so bloom catches the fast ones).
 *
 * It auto-animates with no input — alignment/cohesion keep the murmuration
 * alive even when the pointer never moves — which makes it valid headless.
 */

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Fewer agents + a calmer tempo when motion is unwelcome.
const COUNT = prefersReducedMotion ? 900 : 2600

// ── Simulation constants (world units) ────────────────────────────────────
const BOUND = 16 // half-extent of the cubic flight volume
const PERCEPTION = 3.2 // neighbour radius for alignment / cohesion
const SEP_DIST = 1.5 // tighter radius for separation
const MAX_SPEED = prefersReducedMotion ? 4.0 : 6.5
const MIN_SPEED = MAX_SPEED * 0.45 // keep everyone gliding, never stalled
const MAX_FORCE = 9.0
const NEIGHBOR_CAP = 36 // hard ceiling on neighbours examined per boid

// Steering weights.
const W_SEP = 1.7
const W_ALI = 1.05
const W_COH = 0.95
const W_BOUND = 7.0
const W_POINTER = prefersReducedMotion ? 1.2 : 1.8

// ── Uniform-grid spatial hash (linked list) ───────────────────────────────
// cell index = floor((coord + BOUND) / CELL), clamped to [0, DIM-1].
const CELL = PERCEPTION
const DIM = Math.floor((2 * BOUND) / CELL) + 3
const CELLS = DIM * DIM * DIM
const head = new Int32Array(CELLS) // first boid index in each cell, or -1
const next = new Int32Array(COUNT) // next boid in the same cell, or -1

// Agent state lives in flat typed arrays — no per-frame allocation.
const pos = new Float32Array(COUNT * 3)
const vel = new Float32Array(COUNT * 3)

// Module-level scratch — reused every frame / every instance.
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3(1, 1, 1)
const _quat = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _mat = new THREE.Matrix4()
const _color = new THREE.Color()
const _attractor = new THREE.Vector3()
const _ray = new THREE.Vector3()
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

function cellAxis(v: number): number {
  let c = Math.floor((v + BOUND) / CELL)
  if (c < 0) c = 0
  else if (c >= DIM) c = DIM - 1
  return c
}

function clampForce(x: number, y: number, z: number, out: THREE.Vector3): void {
  out.set(x, y, z)
  const len = out.length()
  if (len > MAX_FORCE) out.multiplyScalar(MAX_FORCE / len)
}

// Tetra-ish heading marker: a low-poly cone tinted by per-instance colour. The
// emissive term is multiplied by vColor so the swarm self-glows for bloom.
const EMISSIVE_BASE = new THREE.Color('#ffffff')
function emissiveByInstance(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec3 totalEmissiveRadiance = emissive;',
    'vec3 totalEmissiveRadiance = emissive * vColor.rgb;',
  )
}

function seedState() {
  const v = new THREE.Vector3()
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3 + 0] = (Math.random() * 2 - 1) * BOUND * 0.8
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * BOUND * 0.5
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOUND * 0.8
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(MAX_SPEED * 0.6)
    vel[i * 3 + 0] = v.x
    vel[i * 3 + 1] = v.y
    vel[i * 3 + 2] = v.z
  }
}

function Swarm() {
  const meshRef = useRef<THREE.InstancedMesh | null>(null)
  const { camera } = useThree()

  // Seed positions/velocities exactly once (module arrays are persistent).
  useMemo(seedState, [])

  const geometry = useMemo(() => {
    // Cone points +Y by default; per-instance quaternion handles heading.
    return new THREE.ConeGeometry(0.16, 0.62, 5)
  }, [])

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#0c1326',
      emissive: EMISSIVE_BASE,
      emissiveIntensity: 1.35,
      metalness: 0.1,
      roughness: 0.55,
    })
    m.onBeforeCompile = emissiveByInstance
    return m
  }, [])

  // Callback ref fires at React commit, before R3F's first render, so the
  // instanceColor attribute (USE_INSTANCING_COLOR → vColor) exists before the
  // material compiles — making the emissive patch valid on the first frame.
  const setMesh = useCallback((mesh: THREE.InstancedMesh | null) => {
    meshRef.current = mesh
    if (!mesh) return
    for (let i = 0; i < COUNT; i++) {
      _color.setHSL(0.58, 0.85, 0.55)
      mesh.setColorAt(i, _color)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.frustumCulled = false
  }, [])

  useFrame((state, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = Math.min(rawDelta, 1 / 30)

    // Pointer → world attractor: cast the pointer ray onto the z=0 plane that
    // bisects the volume. Defaults to the centre when the pointer is idle
    // (NDC 0,0), so the swarm orbits the origin headlessly.
    state.raycaster.setFromCamera(state.pointer, camera)
    if (state.raycaster.ray.intersectPlane(_plane, _ray)) {
      _attractor.copy(_ray)
    } else {
      _attractor.set(0, 0, 0)
    }
    // Clamp the attractor inside the volume so it never yanks boids out.
    _attractor.x = THREE.MathUtils.clamp(_attractor.x, -BOUND, BOUND)
    _attractor.y = THREE.MathUtils.clamp(_attractor.y, -BOUND, BOUND)
    _attractor.z = THREE.MathUtils.clamp(_attractor.z, -BOUND, BOUND)

    // ── Rebuild the spatial hash for this frame ──
    head.fill(-1)
    for (let i = 0; i < COUNT; i++) {
      const ix = cellAxis(pos[i * 3])
      const iy = cellAxis(pos[i * 3 + 1])
      const iz = cellAxis(pos[i * 3 + 2])
      const c = ix + iy * DIM + iz * DIM * DIM
      next[i] = head[c]
      head[c] = i
    }

    const perceptSq = PERCEPTION * PERCEPTION
    const sepSq = SEP_DIST * SEP_DIST

    for (let i = 0; i < COUNT; i++) {
      const px = pos[i * 3]
      const py = pos[i * 3 + 1]
      const pz = pos[i * 3 + 2]
      const vx = vel[i * 3]
      const vy = vel[i * 3 + 1]
      const vz = vel[i * 3 + 2]

      let sepX = 0, sepY = 0, sepZ = 0
      let aliX = 0, aliY = 0, aliZ = 0
      let cohX = 0, cohY = 0, cohZ = 0
      let flockN = 0
      let sepN = 0
      let examined = 0

      const cix = cellAxis(px)
      const ciy = cellAxis(py)
      const ciz = cellAxis(pz)

      // Scan the 27 neighbouring cells, capped at NEIGHBOR_CAP examinations.
      outer: for (let oz = -1; oz <= 1; oz++) {
        const nz = ciz + oz
        if (nz < 0 || nz >= DIM) continue
        for (let oy = -1; oy <= 1; oy++) {
          const ny = ciy + oy
          if (ny < 0 || ny >= DIM) continue
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cix + ox
            if (nx < 0 || nx >= DIM) continue
            let j = head[nx + ny * DIM + nz * DIM * DIM]
            while (j !== -1) {
              if (j !== i) {
                const dx = px - pos[j * 3]
                const dy = py - pos[j * 3 + 1]
                const dz = pz - pos[j * 3 + 2]
                const d2 = dx * dx + dy * dy + dz * dz
                if (d2 < perceptSq && d2 > 1e-6) {
                  aliX += vel[j * 3]
                  aliY += vel[j * 3 + 1]
                  aliZ += vel[j * 3 + 2]
                  cohX += pos[j * 3]
                  cohY += pos[j * 3 + 1]
                  cohZ += pos[j * 3 + 2]
                  flockN++
                  if (d2 < sepSq) {
                    // Push away, weighted by inverse distance.
                    const inv = 1 / d2
                    sepX += dx * inv
                    sepY += dy * inv
                    sepZ += dz * inv
                    sepN++
                  }
                }
                if (++examined >= NEIGHBOR_CAP) break outer
              }
              j = next[j]
            }
          }
        }
      }

      let ax = 0, ay = 0, az = 0

      // Alignment: steer toward the neighbours' average heading.
      if (flockN > 0) {
        let avx = aliX / flockN
        let avy = aliY / flockN
        let avz = aliZ / flockN
        const l = Math.hypot(avx, avy, avz)
        if (l > 1e-5) {
          const s = MAX_SPEED / l
          avx = avx * s - vx
          avy = avy * s - vy
          avz = avz * s - vz
          clampForce(avx, avy, avz, _dir)
          ax += _dir.x * W_ALI
          ay += _dir.y * W_ALI
          az += _dir.z * W_ALI
        }

        // Cohesion: steer toward the neighbours' centre of mass.
        let cx = cohX / flockN - px
        let cy = cohY / flockN - py
        let cz = cohZ / flockN - pz
        const cl = Math.hypot(cx, cy, cz)
        if (cl > 1e-5) {
          const s = MAX_SPEED / cl
          cx = cx * s - vx
          cy = cy * s - vy
          cz = cz * s - vz
          clampForce(cx, cy, cz, _dir)
          ax += _dir.x * W_COH
          ay += _dir.y * W_COH
          az += _dir.z * W_COH
        }
      }

      // Separation: steer away from crowding neighbours.
      if (sepN > 0) {
        const l = Math.hypot(sepX, sepY, sepZ)
        if (l > 1e-5) {
          const s = MAX_SPEED / l
          clampForce(sepX * s - vx, sepY * s - vy, sepZ * s - vz, _dir)
          ax += _dir.x * W_SEP
          ay += _dir.y * W_SEP
          az += _dir.z * W_SEP
        }
      }

      // Pointer attractor: pull toward the projected world point.
      let tx = _attractor.x - px
      let ty = _attractor.y - py
      let tz = _attractor.z - pz
      const tl = Math.hypot(tx, ty, tz)
      if (tl > 1e-4) {
        const s = MAX_SPEED / tl
        clampForce(tx * s - vx, ty * s - vy, tz * s - vz, _dir)
        ax += _dir.x * W_POINTER
        ay += _dir.y * W_POINTER
        az += _dir.z * W_POINTER
      }

      // Soft bounds: turn back smoothly as a boid nears a wall.
      const margin = BOUND * 0.82
      if (px > margin) ax -= (px - margin) * W_BOUND
      else if (px < -margin) ax -= (px + margin) * W_BOUND
      if (py > margin) ay -= (py - margin) * W_BOUND
      else if (py < -margin) ay -= (py + margin) * W_BOUND
      if (pz > margin) az -= (pz - margin) * W_BOUND
      else if (pz < -margin) az -= (pz + margin) * W_BOUND

      // Integrate velocity, clamp to [MIN_SPEED, MAX_SPEED].
      let nvx = vx + ax * dt
      let nvy = vy + ay * dt
      let nvz = vz + az * dt
      let sp = Math.hypot(nvx, nvy, nvz)
      if (sp > MAX_SPEED) {
        const s = MAX_SPEED / sp
        nvx *= s; nvy *= s; nvz *= s; sp = MAX_SPEED
      } else if (sp < MIN_SPEED && sp > 1e-5) {
        const s = MIN_SPEED / sp
        nvx *= s; nvy *= s; nvz *= s; sp = MIN_SPEED
      }
      vel[i * 3] = nvx
      vel[i * 3 + 1] = nvy
      vel[i * 3 + 2] = nvz

      // Integrate position.
      const npx = px + nvx * dt
      const npy = py + nvy * dt
      const npz = pz + nvz * dt
      pos[i * 3] = npx
      pos[i * 3 + 1] = npy
      pos[i * 3 + 2] = npz

      // Orient the cone along velocity, write the instance matrix.
      _dir.set(nvx, nvy, nvz).multiplyScalar(1 / sp)
      _quat.setFromUnitVectors(_up, _dir)
      _pos.set(npx, npy, npz)
      _mat.compose(_pos, _quat, _scale)
      mesh.setMatrixAt(i, _mat)

      // Colour by speed: slow → cool blue, fast → warm magenta/red.
      const norm = (sp - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)
      const hue = 0.62 - THREE.MathUtils.clamp(norm, 0, 1) * 0.62
      _color.setHSL(hue, 0.9, 0.56)
      mesh.setColorAt(i, _color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={setMesh} args={[geometry, material, COUNT]} />
  )
}

// Gradient backdrop — a large inward-facing sphere shaded by world height, so
// the volume sits in a soft vertical wash rather than a flat fill.
const bgVertex = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const bgFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uTop;
  uniform vec3 uBot;
  varying vec3 vLocal;
  void main() {
    float t = clamp(vLocal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(uBot, uTop, pow(t, 1.3));
    gl_FragColor = vec4(c, 1.0);
  }
`

function Backdrop() {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color('#10162e') },
      uBot: { value: new THREE.Color('#03040a') },
    }),
    [],
  )
  return (
    <mesh frustumCulled={false}>
      <sphereGeometry args={[60, 32, 16]} />
      <shaderMaterial
        vertexShader={bgVertex}
        fragmentShader={bgFragment}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

export default function BoidsSwarm() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#03040a' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 4, 34], fov: 52, near: 0.1, far: 200 }}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, 0, 0)
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
        }}
      >
        <color attach="background" args={['#03040a']} />
        <fog attach="fog" args={['#05060f', 24, 64]} />
        <hemisphereLight args={['#9fb6ff', '#0a0a16', 0.6]} />
        <directionalLight position={[8, 12, 6]} intensity={1.6} color="#ffe9d0" />
        <directionalLight position={[-10, -4, -8]} intensity={0.5} color="#5b78ff" />
        <Backdrop />
        <Swarm />
        <EffectComposer>
          <Bloom
            intensity={0.85}
            luminanceThreshold={0.35}
            luminanceSmoothing={0.3}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>BOIDS · FLOCKING SWARM</span>
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
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.2em', fontSize: 11, color: '#86a0d8' },
  back: { color: '#9ab0e0', textDecoration: 'none', fontSize: 13 },
}
