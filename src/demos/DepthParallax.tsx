import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Depth-driven 2.5D parallax — the browser-ml-visuals skill made literal.
 *
 * A scene is drawn procedurally onto a COLOR canvas and, in lockstep, a DEPTH
 * canvas (each layer painted with its true depth). The fragment shader offsets
 * the colour lookup by `depth * parallax`, so moving the pointer (or the idle
 * sway) gives a convincing 2.5D pop with zero network assets — reliable even
 * headless. The "Depth Anything" button then runs a real transformers.js
 * depth-estimation model (WebGPU) on the rendered image and swaps in the
 * estimated depth, demonstrating the full ML→DataTexture→shader bridge.
 */

const W = 1024
const H = 768
const IMG_ASPECT = W / H

// ─── Procedural scene: paint colour + depth layers together ────────
type Layer = { depth: number; draw: (c: CanvasRenderingContext2D) => void }

function buildScene(): { color: HTMLCanvasElement; depth: HTMLCanvasElement } {
  const color = document.createElement('canvas')
  const depth = document.createElement('canvas')
  color.width = depth.width = W
  color.height = depth.height = H
  const cc = color.getContext('2d')
  const dc = depth.getContext('2d')
  if (!cc || !dc) throw new Error('2d context unavailable')

  // Sky (farthest).
  const sky = cc.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#0a1230')
  sky.addColorStop(0.5, '#3b2a6b')
  sky.addColorStop(0.75, '#b5577d')
  sky.addColorStop(1, '#f2a65a')
  cc.fillStyle = sky
  cc.fillRect(0, 0, W, H)
  dc.fillStyle = grey(0.06)
  dc.fillRect(0, 0, W, H)

  // A low sun glow for depth-independent ambience (painted at sky depth).
  const sun = cc.createRadialGradient(W * 0.5, H * 0.72, 10, W * 0.5, H * 0.72, 260)
  sun.addColorStop(0, 'rgba(255,238,200,0.95)')
  sun.addColorStop(1, 'rgba(255,238,200,0)')
  cc.fillStyle = sun
  cc.fillRect(0, 0, W, H)

  const layers: Layer[] = [
    // Distant ridge
    {
      depth: 0.3,
      draw: (c) => ridge(c, H * 0.62, 70, '#2a2350', 7, 11),
    },
    // Mid ridge
    {
      depth: 0.55,
      draw: (c) => ridge(c, H * 0.72, 110, '#241a3e', 5, 23),
    },
    // Foreground hills
    {
      depth: 0.78,
      draw: (c) => ridge(c, H * 0.85, 150, '#150f24', 4, 41),
    },
  ]

  for (const layer of layers) {
    cc.save()
    layer.draw(cc)
    cc.restore()
    // Re-draw the same silhouette into the depth canvas as a flat grey.
    dc.save()
    dc.fillStyle = grey(layer.depth)
    dc.strokeStyle = grey(layer.depth)
    layer.draw(dc)
    dc.restore()
  }

  // Foreground subject: a monolith arch (nearest).
  drawArch(cc, '#0a0712')
  dc.save()
  dc.fillStyle = grey(0.98)
  drawArch(dc, grey(0.98))
  dc.restore()

  return { color, depth }
}

function grey(v: number) {
  const n = Math.round(v * 255)
  return `rgb(${n},${n},${n})`
}

// A jagged horizon filled below — both ctx use the same path so colour and
// depth silhouettes align exactly.
function ridge(c: CanvasRenderingContext2D, baseY: number, amp: number, fill: string, steps: number, seed: number) {
  c.fillStyle = fill
  c.beginPath()
  c.moveTo(0, H)
  c.lineTo(0, baseY)
  let s = seed
  for (let i = 0; i <= steps; i++) {
    s = (s * 9301 + 49297) % 233280
    const r = s / 233280
    const x = (i / steps) * W
    const y = baseY - amp * (0.4 + 0.6 * r) * Math.sin((i / steps) * 3.14159 + r)
    c.lineTo(x, y)
  }
  c.lineTo(W, H)
  c.closePath()
  c.fill()
}

function drawArch(c: CanvasRenderingContext2D, fill: string) {
  c.fillStyle = fill
  const cx = W * 0.5
  const baseY = H
  c.beginPath()
  c.moveTo(cx - 150, baseY)
  c.lineTo(cx - 150, H * 0.45)
  c.arc(cx, H * 0.45, 150, Math.PI, 0, false)
  c.lineTo(cx + 150, baseY)
  c.lineTo(cx + 70, baseY)
  c.lineTo(cx + 70, H * 0.52)
  c.arc(cx, H * 0.52, 70, 0, Math.PI, false)
  c.lineTo(cx - 70, baseY)
  c.closePath()
  c.fill()
}

// ─── Shaders ───────────────────────────────────────────────────────
const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform vec2 uScale;      // cover-fit
  uniform vec2 uParallax;   // offset direction * strength
  uniform float uVignette;
  varying vec2 vUv;

  void main() {
    vec2 base = (vUv - 0.5) * uScale + 0.5;
    float d = texture2D(uDepth, base).r;
    // Layered parallax: shift sampling proportional to depth.
    vec2 uv = base + uParallax * (d - 0.45);
    uv = clamp(uv, 0.001, 0.999);
    vec3 col = texture2D(uColor, uv).rgb;
    // Slight depth-of-field tint: push far pixels cooler.
    col = mix(col, col * vec3(0.85, 0.9, 1.1), (1.0 - d) * 0.25);
    // Vignette.
    float v = smoothstep(1.1, 0.3, length(vUv - 0.5) * 1.6);
    col *= mix(1.0, v, uVignette);
    gl_FragColor = vec4(col, 1.0);
  }
`

type Uniforms = {
  uColor: { value: THREE.Texture | null }
  uDepth: { value: THREE.Texture | null }
  uScale: { value: THREE.Vector2 }
  uParallax: { value: THREE.Vector2 }
  uVignette: { value: number }
}

function ParallaxPlane({ depthRef }: { depthRef: React.RefObject<THREE.Texture | null> }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const { size } = useThree()
  const target = useRef(new THREE.Vector2(0, 0))
  const current = useRef(new THREE.Vector2(0, 0))

  const { colorTex, baseDepthTex } = useMemo(() => {
    const { color, depth } = buildScene()
    const ct = new THREE.CanvasTexture(color)
    const dt = new THREE.CanvasTexture(depth)
    for (const t of [ct, dt]) {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.minFilter = THREE.LinearFilter
      t.magFilter = THREE.LinearFilter
    }
    ct.colorSpace = THREE.SRGBColorSpace
    return { colorTex: ct, baseDepthTex: dt }
  }, [])

  useEffect(() => {
    return () => {
      colorTex.dispose()
      baseDepthTex.dispose()
    }
  }, [colorTex, baseDepthTex])

  const uniforms = useMemo<Uniforms>(
    () => ({
      uColor: { value: colorTex },
      uDepth: { value: baseDepthTex },
      uScale: { value: new THREE.Vector2(1, 1) },
      uParallax: { value: new THREE.Vector2(0, 0) },
      uVignette: { value: 1 },
    }),
    [colorTex, baseDepthTex],
  )

  useFrame((state, delta) => {
    const viewA = size.width / size.height
    // Cover fit.
    if (viewA < IMG_ASPECT) uniforms.uScale.value.set(viewA / IMG_ASPECT, 1)
    else uniforms.uScale.value.set(1, IMG_ASPECT / viewA)

    // Pointer + idle sway → parallax offset.
    const t = state.clock.elapsedTime
    target.current.set(
      state.pointer.x * 0.05 + Math.sin(t * 0.4) * 0.012,
      state.pointer.y * 0.05 + Math.cos(t * 0.33) * 0.012,
    )
    const ease = Math.min(1, delta * 4)
    current.current.lerp(target.current, ease)
    uniforms.uParallax.value.copy(current.current)

    // Adopt an ML depth map if one has been produced.
    if (depthRef.current && uniforms.uDepth.value !== depthRef.current) {
      uniforms.uDepth.value = depthRef.current
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={vert} fragmentShader={frag} uniforms={uniforms} />
    </mesh>
  )
}

// ─── Depth Anything (transformers.js, lazy from CDN) ───────────────
// Static import is deliberately avoided: @huggingface/transformers is a large
// ML runtime we do NOT want in the bundle or as a hard dependency. It is an
// opt-in, platform-capable (WebGPU) feature loaded from CDN only when the user
// clicks — exactly the runtime-selected/plugin case the static-import rule
// exempts. The specifier is held in a variable so the bundler leaves it external.
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0'

async function estimateDepth(colorCanvas: HTMLCanvasElement): Promise<THREE.DataTexture> {
  const mod: unknown = await import(/* @vite-ignore */ TRANSFORMERS_CDN)
  if (
    !mod ||
    typeof mod !== 'object' ||
    !('pipeline' in mod) ||
    typeof mod.pipeline !== 'function'
  ) {
    throw new Error('transformers.js: pipeline export not found')
  }
  const pipeline = mod.pipeline
  const url = colorCanvas.toDataURL('image/png')
  const pipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
    device: 'webgpu',
    dtype: 'fp16',
  })
  if (typeof pipe !== 'function') throw new Error('transformers.js: pipe is not callable')
  const out: unknown = await pipe(url)

  // out.depth is a RawImage: { data: Uint8…, width, height, channels }
  if (!out || typeof out !== 'object' || !('depth' in out)) {
    throw new Error('depth-estimation: no depth field')
  }
  const depth = out.depth
  if (
    !depth ||
    typeof depth !== 'object' ||
    !('data' in depth) ||
    !('width' in depth) ||
    !('height' in depth)
  ) {
    throw new Error('depth-estimation: malformed RawImage')
  }
  const data = depth.data
  const dw = depth.width
  const dh = depth.height
  if (!(typeof dw === 'number') || !(typeof dh === 'number')) {
    throw new Error('depth-estimation: bad dimensions')
  }
  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw new Error('depth-estimation: unexpected data type')
  }
  const channels = data.length / (dw * dh)
  const out8 = new Uint8Array(dw * dh)
  for (let i = 0; i < dw * dh; i++) out8[i] = data[i * channels]
  const tex = new THREE.DataTexture(out8, dw, dh, THREE.RedFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.flipY = true
  tex.needsUpdate = true
  return tex
}

export default function DepthParallax() {
  const depthRef = useRef<THREE.Texture | null>(null)
  const sceneCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ml' | 'error'>('idle')

  // Keep a colour canvas around for the ML pass (re-derive deterministically).
  if (!sceneCanvasRef.current) sceneCanvasRef.current = buildScene().color

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04030a' }}>
      <Canvas orthographic camera={{ zoom: 1, position: [0, 0, 1] }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ParallaxPlane depthRef={depthRef} />
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>DEPTH PARALLAX</span>
        <button
          style={ui.btn}
          disabled={status === 'loading'}
          onClick={() => {
            const canvas = sceneCanvasRef.current
            if (!canvas) return
            setStatus('loading')
            estimateDepth(canvas)
              .then((tex) => {
                depthRef.current = tex
                setStatus('ml')
              })
              .catch((e: unknown) => {
                console.error(e)
                setStatus('error')
              })
          }}
        >
          {status === 'loading' ? '… estimating' : '🧠 Depth Anything (WebGPU)'}
        </button>
        <span style={ui.note}>
          {status === 'ml'
            ? 'using ML-estimated depth'
            : status === 'error'
              ? 'ML unavailable — using authored depth'
              : 'authored depth · move the pointer'}
        </span>
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
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#d89ab8' },
  btn: {
    background: 'rgba(28,16,28,0.7)',
    color: '#ffe0ee',
    border: '1px solid #4a2c40',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  note: { color: '#b899aa', fontSize: 12 },
  back: { color: '#d0a0c0', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
