import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { motion } from 'framer-motion'
import Lenis from 'lenis'
import * as THREE from 'three'

/**
 * SIGNAL ∕ NOISE — the synthesis hero.
 *
 * One cohesive scroll-driven narrative built from the whole stack: a 24k-particle
 * field morphs across three acts (chaotic noise cloud → ordered sphere → the word
 * SIGNAL), the pointer magnetically disturbs the field (custom interaction as the
 * through-line), glow is additive-baked (composer-free — verified-reliable),
 * smooth scroll via Lenis drives the morph, and kinetic type (framer-motion)
 * carries the copy. This is the "remove the noise, keep the signal" thesis made
 * literal — composition + interaction + narrative + type, not a single trick.
 */

const COUNT = 24000

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ─── Target position sets ──────────────────────────────────────────
function randInSphere(r: number): [number, number, number] {
  let x = 0
  let y = 0
  let z = 0
  // rejection sample for a uniform ball
  for (let i = 0; i < 8; i++) {
    x = (Math.random() * 2 - 1) * r
    y = (Math.random() * 2 - 1) * r
    z = (Math.random() * 2 - 1) * r
    if (x * x + y * y + z * z <= r * r) break
  }
  return [x, y, z]
}

function fibonacciSphere(i: number, n: number, r: number): [number, number, number] {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / n)
  const theta = Math.PI * (1 + Math.sqrt(5)) * i
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  ]
}

// Sample filled pixels of the word "SIGNAL" → 3D points.
function wordPoints(count: number): Float32Array {
  const out = new Float32Array(count * 3)
  const cw = 720
  const ch = 200
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  const filled: Array<[number, number]> = []
  if (ctx) {
    ctx.fillStyle = '#fff'
    ctx.font = '900 150px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('SIGNAL', cw / 2, ch / 2 + 6)
    const img = ctx.getImageData(0, 0, cw, ch).data
    for (let y = 0; y < ch; y += 2) {
      for (let x = 0; x < cw; x += 2) {
        if (img[(y * cw + x) * 4 + 3] > 128) filled.push([x, y])
      }
    }
  }
  const scale = 9 / cw
  for (let i = 0; i < count; i++) {
    if (filled.length > 0) {
      const [px, py] = filled[(Math.random() * filled.length) | 0]
      out[i * 3] = (px - cw / 2) * scale
      out[i * 3 + 1] = -(py - ch / 2) * scale
      out[i * 3 + 2] = (Math.random() - 0.5) * 0.35
    } else {
      const [x, y, z] = randInSphere(2)
      out[i * 3] = x
      out[i * 3 + 1] = y
      out[i * 3 + 2] = z
    }
  }
  return out
}

// ─── Shaders ───────────────────────────────────────────────────────
const vert = /* glsl */ `
  uniform float uProgress;   // 0..2 across the three acts
  uniform float uTime;
  uniform vec3 uPointer;
  uniform float uPointerR;
  uniform float uSize;
  attribute vec3 aCloud;
  attribute vec3 aSphere;
  attribute vec3 aGrid;
  attribute float aSeed;
  varying float vHeat;
  varying float vSeed;

  vec3 morph(float p) {
    vec3 a = mix(aCloud, aSphere, smoothstep(0.0, 1.0, clamp(p, 0.0, 1.0)));
    vec3 b = mix(aSphere, aGrid, smoothstep(0.0, 1.0, clamp(p - 1.0, 0.0, 1.0)));
    return p < 1.0 ? a : b;
  }

  void main() {
    float grid = smoothstep(1.0, 2.0, uProgress); // 0 sphere → 1 word
    vec3 pos = morph(uProgress);
    float t = uTime * 0.5 + aSeed * 6.2831853;
    pos += 0.045 * (1.0 - grid) * vec3(sin(t), cos(t * 1.3), sin(t * 0.7));

    // Magnetic pointer repulsion — the narrative through-line.
    vec3 d = pos - uPointer;
    float dist = length(d);
    float force = uPointerR / (dist * dist + 0.25);
    pos += normalize(d + 1e-4) * force;

    vHeat = force;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (170.0 / -mv.z) * (0.55 + 0.9 * aSeed) * (1.0 - 0.55 * grid);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vHeat;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uColorA, uColorB, vSeed);
    col += clamp(vHeat, 0.0, 2.0) * vec3(1.0, 0.55, 0.25) * 2.2; // heat on disturbance
    gl_FragColor = vec4(col * 0.42, alpha * 0.8);
  }
`

type Uniforms = {
  uProgress: { value: number }
  uTime: { value: number }
  uPointer: { value: THREE.Vector3 }
  uPointerR: { value: number }
  uSize: { value: number }
  uColorA: { value: THREE.Color }
  uColorB: { value: THREE.Color }
}

const _ndc = new THREE.Vector3()
const _world = new THREE.Vector3()

function Field({
  progressRef,
  pointerRef,
}: {
  progressRef: React.RefObject<number>
  pointerRef: React.RefObject<{ x: number; y: number; active: boolean }>
}) {
  const group = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const reduced = useRef(reducedMotion())
  const targetProgress = useRef(0)
  const pointerWorld = useRef(new THREE.Vector3(999, 999, 999))

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const cloud = new Float32Array(COUNT * 3)
    const sphere = new Float32Array(COUNT * 3)
    const seed = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const [cx, cy, cz] = randInSphere(3.6)
      cloud[i * 3] = cx
      cloud[i * 3 + 1] = cy
      cloud[i * 3 + 2] = cz
      const [sx, sy, sz] = fibonacciSphere(i, COUNT, 2.2)
      sphere[i * 3] = sx
      sphere[i * 3 + 1] = sy
      sphere[i * 3 + 2] = sz
      seed[i] = Math.random()
    }
    const grid = wordPoints(COUNT)
    g.setAttribute('position', new THREE.BufferAttribute(cloud, 3)) // bounds only
    g.setAttribute('aCloud', new THREE.BufferAttribute(cloud, 3))
    g.setAttribute('aSphere', new THREE.BufferAttribute(sphere, 3))
    g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.computeBoundingSphere()
    return g
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo<Uniforms>(
    () => ({
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uPointerR: { value: 0 },
      uSize: { value: 1.1 },
      uColorA: { value: new THREE.Color('#5b6bff') },
      uColorB: { value: new THREE.Color('#ff7a3c') },
    }),
    [],
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((state, delta) => {
    const u = uniforms
    u.uTime.value = state.clock.elapsedTime

    // Scroll progress (0..1) → act space (0..2), eased.
    targetProgress.current = (progressRef.current ?? 0) * 2
    const ease = Math.min(1, delta * 2.5)
    u.uProgress.value += (targetProgress.current - u.uProgress.value) * ease

    // Pointer → world point on z=0 plane; repulsion fades when inactive.
    const p = pointerRef.current
    if (p && p.active) {
      _ndc.set(p.x, p.y, 0.5).unproject(camera)
      const dir = _ndc.sub(camera.position).normalize()
      const t = -camera.position.z / dir.z
      _world.copy(camera.position).add(dir.multiplyScalar(t))
      pointerWorld.current.lerp(_world, Math.min(1, delta * 6))
      u.uPointer.value.copy(pointerWorld.current)
      u.uPointerR.value += (0.9 - u.uPointerR.value) * Math.min(1, delta * 4)
    } else {
      u.uPointerR.value += (0 - u.uPointerR.value) * Math.min(1, delta * 3)
    }

    // Camera dolly + gentle rotation across the narrative.
    const prog = u.uProgress.value / 2
    const camZ = 8.6 - prog * 1.0
    state.camera.position.z += (camZ - state.camera.position.z) * Math.min(1, delta * 2)
    if (group.current && !reduced.current) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.1) * 0.25 * (1 - prog)
    }
  })

  return (
    <group ref={group}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  )
}

// ─── Copy sections (kinetic type) ──────────────────────────────────
const fade = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } },
} as const

function Act({
  children,
  align = 'center',
}: {
  children: React.ReactNode
  align?: 'center' | 'left'
}) {
  return (
    <section style={{ ...css.act, alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      <motion.div
        variants={fade}
        initial="hidden"
        whileInView="show"
        viewport={{ once: false, amount: 0.5 }}
        style={{ textAlign: align, maxWidth: 720 }}
      >
        {children}
      </motion.div>
    </section>
  )
}

export default function Hero() {
  const progressRef = useRef(0)
  const pointerRef = useRef({ x: 0, y: 0, active: false })

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.09 })
    let raf = 0
    const loop = (t: number) => {
      lenis.raf(t)
      const max = document.documentElement.scrollHeight - window.innerHeight
      progressRef.current = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onMove = (ev: PointerEvent) => {
      pointerRef.current = {
        x: (ev.clientX / window.innerWidth) * 2 - 1,
        y: -(ev.clientY / window.innerHeight) * 2 + 1,
        active: true,
      }
    }
    const onLeave = () => {
      pointerRef.current = { ...pointerRef.current, active: false }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div style={css.root}>
      <div style={css.canvasWrap}>
        <Canvas camera={{ position: [0, 0, 8.5], fov: 52 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#05060c']} />
          <Field progressRef={progressRef} pointerRef={pointerRef} />
        </Canvas>
      </div>

      <main style={css.scroll}>
        <Act>
          <p style={css.eyebrow}>ULTRON · SYNTHESIS HERO</p>
          <h1 style={css.h1}>
            SIGNAL <span style={css.slash}>∕</span> NOISE
          </h1>
          <p style={css.lede}>
            Most of the web is noise. This is what's left when you remove it. Move your
            cursor — the field answers.
          </p>
          <p style={css.scrollhint}>scroll ↓</p>
        </Act>

        <Act align="left">
          <p style={css.kicker}>ACT I — ENTROPY</p>
          <h2 style={css.h2}>A cloud with no center holds no meaning.</h2>
          <p style={css.body}>
            Twenty-four thousand points, scattered. Beautiful, maybe. Legible, no. Spectacle
            without structure is just expensive noise.
          </p>
        </Act>

        <Act align="left">
          <p style={css.kicker}>ACT II — STRUCTURE</p>
          <h2 style={css.h2}>Signal is structure under pressure.</h2>
          <p style={css.body}>
            Pull the same points onto a sphere and order emerges — not by adding more, but by
            constraining what's already there. Craft is subtraction.
          </p>
        </Act>

        <Act>
          <p style={css.kicker}>ACT III — MEANING</p>
          <h2 style={css.h2big}>It resolves into a word.</h2>
          <p style={css.body}>
            The same particles, one more constraint, and the noise becomes language. That's the
            whole job: remove everything that isn't the message.
          </p>
          <p style={css.signoff}>Built by ULTRON — the diff is the answer.</p>
          <a href="?" style={css.back}>
            ← back to index
          </a>
        </Act>
      </main>
    </div>
  )
}

const css: Record<string, React.CSSProperties> = {
  root: { position: 'relative', background: '#05060c' },
  canvasWrap: { position: 'fixed', inset: 0, zIndex: 0 },
  scroll: { position: 'relative', zIndex: 1, pointerEvents: 'none' },
  act: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: 'clamp(24px, 7vw, 120px)',
    color: '#eef0ff',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  eyebrow: { letterSpacing: '0.4em', fontSize: 12, color: '#8a8ad8', margin: '0 0 18px' },
  h1: {
    fontSize: 'clamp(48px, 12vw, 150px)',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 0.95,
    margin: 0,
  },
  slash: { color: '#ff7a3c', fontWeight: 400 },
  lede: {
    fontSize: 'clamp(16px, 2.2vw, 22px)',
    color: '#b6b8d8',
    lineHeight: 1.55,
    maxWidth: 560,
    margin: '28px auto 0',
  },
  scrollhint: { marginTop: 40, color: '#6a6a90', letterSpacing: '0.3em', fontSize: 12 },
  kicker: { letterSpacing: '0.32em', fontSize: 12, color: '#ff9a5c', margin: '0 0 16px' },
  h2: { fontSize: 'clamp(28px, 5vw, 56px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0 },
  h2big: { fontSize: 'clamp(34px, 7vw, 80px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.0, margin: 0 },
  body: { fontSize: 'clamp(15px, 1.8vw, 19px)', color: '#aeb0d0', lineHeight: 1.6, maxWidth: 480, marginTop: 22 },
  signoff: { marginTop: 36, fontSize: 15, color: '#cdbfff', letterSpacing: '0.02em' },
  back: {
    display: 'inline-block',
    marginTop: 24,
    color: '#9fb0ff',
    textDecoration: 'none',
    fontSize: 14,
    pointerEvents: 'auto',
    borderBottom: '1px solid #2c2c4a',
    paddingBottom: 2,
  },
}
