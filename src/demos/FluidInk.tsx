import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

/**
 * FLUID INK — a real-time stable-fluids (Stam / Navier-Stokes) ink solver, the
 * gpu-simulation-systems skill made literal. Every field lives in HalfFloat
 * render targets that are ping-ponged through a chain of fullscreen fragment
 * passes each frame, driven manually with `gl.setRenderTarget` + a single
 * `FullScreenQuad` whose material is swapped per pass:
 *
 *   1. advect velocity (semi-Lagrangian, manual bilerp so NearestFilter is fine)
 *   2. inject forces  (auto-emitters keep it alive; pointer drag adds ink)
 *   3. divergence  →  4. clear+Jacobi pressure (22 iters)  →  5. subtract grad
 *   6. advect dye   →  display (vivid filmic + vignette, bilinear upscale)
 *
 * A priority-1 useFrame takes over the render loop and presents the dye field
 * itself. Velocity + dye dissipate; dt is clamped; prefers-reduced-motion calms
 * the flow. No props, no CPU per-frame allocation, zero new deps.
 */

const SIM_RES = 256
const PRESSURE_ITER = 22
const VEL_DISS = 0.2 // velocity dissipation (per second)
const DYE_DISS = 0.9 // dye dissipation (per second) — ink lingers but fades
const PRESSURE_DECAY = 0.8 // pressure warm-start scale each frame
const SPLAT_FORCE = 6200 // pointer-drag velocity gain (uv-delta -> grid units)
const SPLAT_RADIUS = 0.0014 // gaussian footprint of an ink splat (uv^2)
const TEXEL = 1 / SIM_RES

// Fullscreen pass vertex shader. The FullScreenQuad triangle already spans clip
// space, so we ignore the camera matrices entirely.
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

// Semi-Lagrangian advection. Back-trace the position one step along velocity and
// sample the source field there. Manual bilinear interpolation keeps the result
// smooth even though the targets use NearestFilter.
const ADVECT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;

  vec4 bilerp(sampler2D s, vec2 uv) {
    vec2 st = uv / texelSize - 0.5;
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec4 a = texture2D(s, (i + vec2(0.5, 0.5)) * texelSize);
    vec4 b = texture2D(s, (i + vec2(1.5, 0.5)) * texelSize);
    vec4 c = texture2D(s, (i + vec2(0.5, 1.5)) * texelSize);
    vec4 d = texture2D(s, (i + vec2(1.5, 1.5)) * texelSize);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vec2 coord = vUv - dt * vel * texelSize;
    vec4 result = bilerp(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`

// Divergence of the velocity field. Boundary cells reflect the centre velocity
// so the walls behave like a closed box (no flux through the edges).
const DIVERGENCE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 texelSize;
  void main() {
    vec2 vL = vUv - vec2(texelSize.x, 0.0);
    vec2 vR = vUv + vec2(texelSize.x, 0.0);
    vec2 vB = vUv - vec2(0.0, texelSize.y);
    vec2 vT = vUv + vec2(0.0, texelSize.y);
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float B = texture2D(uVelocity, vB).y;
    float T = texture2D(uVelocity, vT).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vB.y < 0.0) B = -C.y;
    if (vT.y > 1.0) T = -C.y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`

// One Jacobi iteration of the pressure Poisson equation.
const PRESSURE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 texelSize;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
    float div = texture2D(uDivergence, vUv).x;
    float p = (L + R + B + T - div) * 0.25;
    gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
  }
`

// Subtract the pressure gradient to project velocity onto a divergence-free field.
const GRADIENT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 texelSize;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vel -= 0.5 * vec2(R - L, T - B);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`

// Inject a gaussian blob of `color` into `uTarget` (velocity impulse or dye).
const SPLAT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`

// Warm-start helper: scale a field by a constant (used to decay pressure).
const CLEAR_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main() {
    gl_FragColor = value * texture2D(uTexture, vUv);
  }
`

// Final present pass: bilinear upscale of the dye field plus a gentle filmic
// curve, cool ambient floor and vignette so the ink reads as luminous.
const DISPLAY_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uDye;
  uniform vec2 texel;
  vec3 bilerp(sampler2D s, vec2 uv) {
    vec2 st = uv / texel - 0.5;
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec3 a = texture2D(s, (i + vec2(0.5, 0.5)) * texel).rgb;
    vec3 b = texture2D(s, (i + vec2(1.5, 0.5)) * texel).rgb;
    vec3 c = texture2D(s, (i + vec2(0.5, 1.5)) * texel).rgb;
    vec3 d = texture2D(s, (i + vec2(1.5, 1.5)) * texel).rgb;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    vec3 col = bilerp(uDye, vUv);
    col += vec3(0.012, 0.016, 0.028);     // faint cool ambient floor
    col = col / (1.0 + col * 0.30);        // gentle filmic, keeps neon vivid
    vec2 q = vUv - 0.5;
    float vig = smoothstep(1.05, 0.18, dot(q, q) * 1.7);
    col *= vig;
    col = pow(max(col, 0.0), vec3(0.86));  // mild gamma for richness
    gl_FragColor = vec4(col, 1.0);
  }
`

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Module-level scratch — reused every frame, never reallocated.
const _col = new THREE.Color()

// Swap a read/write target pair in place.
function swap<T>(a: { current: T }, b: { current: T }) {
  const t = a.current
  a.current = b.current
  b.current = t
}

// Two synthetic emitters orbiting the centre keep the canvas alive with no
// pointer (and validate the headless render). Each has its own radius, speed,
// phase and hue drift.
const EMITTERS = [
  { rad: 0.19, speed: 0.55, phase: 0.0, hue: 0.55, hueSpeed: 0.06 },
  { rad: 0.13, speed: -0.8, phase: 2.4, hue: 0.92, hueSpeed: 0.09 },
] as const

function FluidSim() {
  const { gl, size } = useThree()
  const reduced = useRef(prefersReducedMotion())

  const fboSettings = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  } as const

  // Ping-pong pairs for velocity, dye and pressure, plus a single divergence target.
  const velA = useFBO(SIM_RES, SIM_RES, fboSettings)
  const velB = useFBO(SIM_RES, SIM_RES, fboSettings)
  const dyeA = useFBO(SIM_RES, SIM_RES, fboSettings)
  const dyeB = useFBO(SIM_RES, SIM_RES, fboSettings)
  const presA = useFBO(SIM_RES, SIM_RES, fboSettings)
  const presB = useFBO(SIM_RES, SIM_RES, fboSettings)
  const divFbo = useFBO(SIM_RES, SIM_RES, fboSettings)

  const velRead = useRef(velA)
  const velWrite = useRef(velB)
  const dyeRead = useRef(dyeA)
  const dyeWrite = useRef(dyeB)
  const presRead = useRef(presA)
  const presWrite = useRef(presB)

  const aspect = useRef(1)
  const seeded = useRef(false)

  // Pointer state in uv space (origin bottom-left, matching texture coords).
  const pointer = useRef({ x: 0.5, y: 0.5, dx: 0, dy: 0, down: false, moved: false })

  // A single quad whose material we swap for every pass.
  const quad = useMemo(() => new FullScreenQuad(), [])

  const mats = useMemo(() => {
    const make = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false })

    const tex = () => ({ value: null as THREE.Texture | null })
    const texel = () => ({ value: new THREE.Vector2(TEXEL, TEXEL) })

    return {
      advect: make(ADVECT_FRAG, {
        uVelocity: tex(),
        uSource: tex(),
        texelSize: texel(),
        dt: { value: 0 },
        dissipation: { value: 0 },
      }),
      divergence: make(DIVERGENCE_FRAG, { uVelocity: tex(), texelSize: texel() }),
      pressure: make(PRESSURE_FRAG, { uPressure: tex(), uDivergence: tex(), texelSize: texel() }),
      gradient: make(GRADIENT_FRAG, { uPressure: tex(), uVelocity: tex(), texelSize: texel() }),
      splat: make(SPLAT_FRAG, {
        uTarget: tex(),
        aspectRatio: { value: 1 },
        color: { value: new THREE.Vector3() },
        point: { value: new THREE.Vector2(0.5, 0.5) },
        radius: { value: SPLAT_RADIUS },
      }),
      clear: make(CLEAR_FRAG, { uTexture: tex(), value: { value: PRESSURE_DECAY } }),
      display: make(DISPLAY_FRAG, { uDye: tex(), texel: { value: new THREE.Vector2(TEXEL, TEXEL) } }),
    }
  }, [])

  const renderPass = useCallback(
    (mat: THREE.Material, target: THREE.WebGLRenderTarget | null) => {
      quad.material = mat
      gl.setRenderTarget(target)
      quad.render(gl)
    },
    [gl, quad],
  )

  // Inject one ink splat: a velocity impulse into the velocity field and a
  // colored blob into the dye field.
  const splat = useCallback(
    (x: number, y: number, dx: number, dy: number, r: number, g: number, b: number) => {
      const m = mats.splat
      m.uniforms.aspectRatio.value = aspect.current
      m.uniforms.point.value.set(x, y)
      m.uniforms.radius.value = SPLAT_RADIUS

      // velocity impulse
      m.uniforms.uTarget.value = velRead.current.texture
      m.uniforms.color.value.set(dx, dy, 0)
      renderPass(m, velWrite.current)
      swap(velRead, velWrite)

      // dye
      m.uniforms.uTarget.value = dyeRead.current.texture
      m.uniforms.color.value.set(r, g, b)
      renderPass(m, dyeWrite.current)
      swap(dyeRead, dyeWrite)
    },
    [mats, renderPass],
  )

  // Pointer listeners on the canvas — converts client coords to uv and tracks drag delta.
  useEffect(() => {
    const el = gl.domElement
    const toUv = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: 1 - (e.clientY - rect.top) / rect.height,
      }
    }
    const onDown = (e: PointerEvent) => {
      const { x, y } = toUv(e)
      const p = pointer.current
      p.x = x
      p.y = y
      p.dx = 0
      p.dy = 0
      p.down = true
      p.moved = false
    }
    const onMove = (e: PointerEvent) => {
      const { x, y } = toUv(e)
      const p = pointer.current
      p.dx = x - p.x
      p.dy = y - p.y
      p.x = x
      p.y = y
      if (p.down) p.moved = true
    }
    const onUp = () => {
      pointer.current.down = false
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  useEffect(() => () => quad.dispose(), [quad])

  // Clear every target once so the first sim frame never samples uninitialized
  // GPU memory (which could seed NaNs that then persist through advection).
  useEffect(() => {
    const prev = gl.getClearColor(new THREE.Color()).getHex()
    const prevAlpha = gl.getClearAlpha()
    gl.setClearColor(0x000000, 1)
    for (const t of [velA, velB, dyeA, dyeB, presA, presB, divFbo]) {
      gl.setRenderTarget(t)
      gl.clear()
    }
    gl.setRenderTarget(null)
    gl.setClearColor(prev, prevAlpha)
  }, [gl, velA, velB, dyeA, dyeB, presA, presB, divFbo])

  useFrame((state, delta) => {
    const slow = reduced.current ? 0.4 : 1
    const dt = Math.min(delta, 1 / 60) * slow
    const t = state.clock.elapsedTime
    aspect.current = size.width / Math.max(1, size.height)

    // 1. advect velocity (self-advection)
    {
      const a = mats.advect
      a.uniforms.uVelocity.value = velRead.current.texture
      a.uniforms.uSource.value = velRead.current.texture
      a.uniforms.dt.value = dt
      a.uniforms.dissipation.value = VEL_DISS
      renderPass(a, velWrite.current)
      swap(velRead, velWrite)
    }

    // 2. forces — initial burst, orbiting auto-emitters, and pointer drag.
    if (!seeded.current) {
      seeded.current = true
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2
        const x = 0.5 + Math.cos(ang) * 0.16
        const y = 0.5 + Math.sin(ang) * 0.16
        // tangential swirl impulse
        const vx = -Math.sin(ang) * 260
        const vy = Math.cos(ang) * 260
        _col.setHSL(k / 6, 1, 0.5)
        splat(x, y, vx, vy, _col.r * 0.25, _col.g * 0.25, _col.b * 0.25)
      }
    }

    for (let i = 0; i < EMITTERS.length; i++) {
      const e = EMITTERS[i]
      const a = e.phase + t * e.speed * slow
      const x = 0.5 + Math.cos(a) * e.rad
      const y = 0.5 + Math.sin(a) * e.rad
      // velocity tangent to the orbit, scaled into grid units
      const amp = 150 * slow
      const vx = -Math.sin(a) * amp
      const vy = Math.cos(a) * amp
      _col.setHSL((e.hue + t * e.hueSpeed) % 1, 1, 0.5)
      const ink = 0.12
      splat(x, y, vx, vy, _col.r * ink, _col.g * ink, _col.b * ink)
    }

    const p = pointer.current
    if (p.down && p.moved) {
      p.moved = false
      _col.setHSL((t * 0.12) % 1, 1, 0.5)
      const ink = 0.22
      splat(p.x, p.y, p.dx * SPLAT_FORCE, p.dy * SPLAT_FORCE, _col.r * ink, _col.g * ink, _col.b * ink)
    }

    // 3. divergence of the (now forced) velocity field
    {
      const d = mats.divergence
      d.uniforms.uVelocity.value = velRead.current.texture
      renderPass(d, divFbo)
    }

    // 4. decay (warm-start) pressure, then Jacobi-iterate the Poisson equation
    {
      const c = mats.clear
      c.uniforms.uTexture.value = presRead.current.texture
      renderPass(c, presWrite.current)
      swap(presRead, presWrite)

      const pr = mats.pressure
      pr.uniforms.uDivergence.value = divFbo.texture
      for (let i = 0; i < PRESSURE_ITER; i++) {
        pr.uniforms.uPressure.value = presRead.current.texture
        renderPass(pr, presWrite.current)
        swap(presRead, presWrite)
      }
    }

    // 5. subtract pressure gradient -> divergence-free velocity
    {
      const g = mats.gradient
      g.uniforms.uPressure.value = presRead.current.texture
      g.uniforms.uVelocity.value = velRead.current.texture
      renderPass(g, velWrite.current)
      swap(velRead, velWrite)
    }

    // 6. advect dye through the velocity field
    {
      const a = mats.advect
      a.uniforms.uVelocity.value = velRead.current.texture
      a.uniforms.uSource.value = dyeRead.current.texture
      a.uniforms.dt.value = dt
      a.uniforms.dissipation.value = DYE_DISS
      renderPass(a, dyeWrite.current)
      swap(dyeRead, dyeWrite)
    }

    // present the dye field to the canvas (priority-1: we own the render loop)
    mats.display.uniforms.uDye.value = dyeRead.current.texture
    renderPass(mats.display, null)
  }, 1)

  return null
}

export default function FluidInk() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04050a' }}>
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: false, preserveDrawingBuffer: false }}
      >
        <FluidSim />
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>FLUID INK · STABLE FLUIDS</span>
        <span style={ui.note}>drag to paint with ink</span>
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
  tag: {
    letterSpacing: '0.22em',
    fontSize: 11,
    color: '#a8b8ff',
    background: 'rgba(12,16,32,0.7)',
    border: '1px solid #2a3360',
    borderRadius: 999,
    padding: '5px 12px',
    backdropFilter: 'blur(8px)',
  },
  note: { color: '#7c84a8', fontSize: 12 },
  back: { color: '#a8b8ff', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
