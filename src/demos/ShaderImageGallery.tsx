import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group, Mesh, ShaderMaterial, Vector2 } from 'three'
import vertexShader from '../shaders/image.vert'
import fragmentShader from '../shaders/image.frag'

// ─────────────────────────────────────────────────────────────────────────────
// Procedural textures — three distinct, bold abstract panels drawn on a canvas.
// No network assets; every panel is generated at mount for a reliable headless
// render. Aspect 0.8 (portrait) matches the plane geometry + shader ASPECT const.
// ─────────────────────────────────────────────────────────────────────────────

const TEX_W = 1024
const TEX_H = 1280

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * alpha})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
  }
}

function centerGlyph(ctx: CanvasRenderingContext2D, w: number, h: number, glyph: string, fill: string): void {
  ctx.save()
  ctx.font = `900 ${Math.floor(h * 0.66)}px "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fill
  ctx.fillText(glyph, w * 0.5, h * 0.52)
  ctx.restore()
}

// Panel A — indigo → electric violet diagonal duotone, drifting orbs, glyph "A".
const drawA: DrawFn = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#150e34')
  g.addColorStop(0.55, '#3a1c8c')
  g.addColorStop(1, '#7c43f5')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < 5; i++) {
    const rg = ctx.createRadialGradient(
      w * (0.2 + 0.15 * i), h * (0.15 + 0.18 * i), 10,
      w * (0.2 + 0.15 * i), h * (0.15 + 0.18 * i), w * 0.5,
    )
    rg.addColorStop(0, 'rgba(150,110,255,0.35)')
    rg.addColorStop(1, 'rgba(150,110,255,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalCompositeOperation = 'source-over'

  centerGlyph(ctx, w, h, 'A', 'rgba(238,233,255,0.94)')
  grain(ctx, w, h, 7000, 0.05)
}

// Panel B — charcoal → molten copper radial, concentric rings, glyph "V".
const drawB: DrawFn = (ctx, w, h) => {
  ctx.fillStyle = '#0d0a08'
  ctx.fillRect(0, 0, w, h)

  const rg = ctx.createRadialGradient(w * 0.5, h * 0.42, 30, w * 0.5, h * 0.42, h * 0.72)
  rg.addColorStop(0, '#f6ad58')
  rg.addColorStop(0.42, '#bf6420')
  rg.addColorStop(1, '#160c06')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(18,9,4,0.34)'
  ctx.lineWidth = 14
  for (let r = 80; r < h; r += 110) {
    ctx.beginPath()
    ctx.arc(w * 0.5, h * 0.42, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  centerGlyph(ctx, w, h, 'V', 'rgba(28,16,8,0.9)')
  grain(ctx, w, h, 7000, 0.05)
}

// Panel C — near-black → emerald diagonal bands, sweeping stripes, glyph "L".
const drawC: DrawFn = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, h, w, 0)
  g.addColorStop(0, '#021713')
  g.addColorStop(0.5, '#0c5e4c')
  g.addColorStop(1, '#27e0ad')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(w * 0.5, h * 0.5)
  ctx.rotate(-Math.PI / 5)
  ctx.fillStyle = 'rgba(2,18,15,0.22)'
  const span = w + h
  for (let x = -span; x < span; x += 150) {
    ctx.fillRect(x, -span, 64, span * 2)
  }
  ctx.restore()

  centerGlyph(ctx, w, h, 'L', 'rgba(225,255,246,0.92)')
  grain(ctx, w, h, 7000, 0.05)
}

function makeTexture(draw: DrawFn): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  draw(ctx, TEX_W, TEX_H)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

// ─────────────────────────────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

type ImagePlaneProps = {
  texture: THREE.Texture
  position: [number, number, number]
  size: [number, number]
}

function ImagePlane({ texture, position, size }: ImagePlaneProps) {
  const mesh = useRef<Mesh>(null)
  const material = useRef<ShaderMaterial>(null)
  const target = useRef(0)
  const pointer = useRef(new THREE.Vector2(0.5, 0.5))
  const reduced = usePrefersReducedMotion()

  const uniforms = useMemo(
    () => ({
      uTex: { value: texture },
      uHover: { value: 0 },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    }),
    [texture],
  )

  useFrame((state, delta) => {
    const m = material.current
    const me = mesh.current
    if (!m || !me) return

    if (!reduced) m.uniforms.uTime.value = state.clock.elapsedTime

    const hover = THREE.MathUtils.damp(m.uniforms.uHover.value, target.current, 6, delta)
    m.uniforms.uHover.value = hover
    ;(m.uniforms.uMouse.value as Vector2).lerp(pointer.current, 0.15)

    const scale = THREE.MathUtils.damp(me.scale.x, 1 + hover * 0.06, 9, delta)
    me.scale.set(scale, scale, 1)
    me.position.z = THREE.MathUtils.damp(me.position.z, position[2] + hover * 0.25, 9, delta)
  })

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    target.current = 1
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    target.current = 0
    document.body.style.cursor = 'auto'
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) pointer.current.set(e.uv.x, e.uv.y)
  }

  return (
    <mesh ref={mesh} position={position} onPointerOver={onOver} onPointerOut={onOut} onPointerMove={onMove}>
      <planeGeometry args={[size[0], size[1], 1, 1]} />
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  )
}

const PLANE_ASPECT = 0.8 // width / height — matches the shader ASPECT const

// Lays the three portrait panels out from the live viewport so the row stays
// large + centered and never overflows horizontally (binding constraint wins).
function Gallery({ textures }: { textures: THREE.Texture[] }) {
  const group = useRef<Group>(null)
  const { width, height } = useThree((s) => s.viewport)
  const reduced = usePrefersReducedMotion()

  const { size, xs } = useMemo(() => {
    let planeH = height * 0.58
    let planeW = planeH * PLANE_ASPECT
    let gap = planeW * 0.12
    const rowWidth = planeW * 3 + gap * 2
    const maxRow = width * 0.88
    if (rowWidth > maxRow) {
      const k = maxRow / rowWidth
      planeW *= k
      planeH *= k
      gap *= k
    }
    const step = planeW + gap
    return { size: [planeW, planeH] as [number, number], xs: [-step, 0, step] }
  }, [width, height])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const tx = reduced ? 0 : -state.pointer.y * 0.08
    const ty = reduced ? 0 : state.pointer.x * 0.1
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, tx, 4, delta)
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, ty, 4, delta)
  })

  return (
    <group ref={group}>
      {textures.map((tex, i) => (
        <ImagePlane key={i} texture={tex} position={[xs[i], 0, 0]} size={size} />
      ))}
    </group>
  )
}

export default function ShaderImageGallery() {
  const textures = useMemo(() => [makeTexture(drawA), makeTexture(drawB), makeTexture(drawC)], [])

  useEffect(() => {
    const captured = textures
    return () => {
      captured.forEach((t) => t.dispose())
    }
  }, [textures])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: 'radial-gradient(120% 120% at 50% 30%, #0c0c18 0%, #050509 60%, #030305 100%)',
      }}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 4], fov: 40 }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#070710']} />
        <Gallery textures={textures} />
      </Canvas>
    </div>
  )
}
