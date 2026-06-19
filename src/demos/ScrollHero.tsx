import { useMemo, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import * as THREE from 'three'
import type { ShaderMaterial, Mesh, IUniform } from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useSmoothScroll } from '../lib/smoothScroll'
import vertexShader from '../shaders/hero.vert'
import fragmentShader from '../shaders/hero.frag'

interface ScrollState {
  progress: number
}

interface HeroUniforms {
  uTime: IUniform<number>
  uProgress: IUniform<number>
  uDisplace: IUniform<number>
  uFreq: IUniform<number>
  uColorA: IUniform<THREE.Color>
  uColorB: IUniform<THREE.Color>
  [key: string]: IUniform
}

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function HeroObject({ scroll }: { scroll: RefObject<ScrollState> }) {
  const matRef = useRef<ShaderMaterial>(null)
  const meshRef = useRef<Mesh>(null)

  const uniforms = useMemo<HeroUniforms>(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uDisplace: { value: 0.18 },
      uFreq: { value: 1.1 },
      uColorA: { value: new THREE.Color('#2a165e') },
      uColorB: { value: new THREE.Color('#06384f') },
    }),
    [],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const p = scroll.current.progress

    const mat = matRef.current
    if (mat) {
      const u = mat.uniforms as HeroUniforms
      u.uTime.value += REDUCED ? dt * 0.3 : dt
      u.uProgress.value += (p - u.uProgress.value) * 0.1
      u.uDisplace.value = 0.18 + u.uProgress.value * 0.55
    }

    const mesh = meshRef.current
    if (mesh) {
      if (!REDUCED) mesh.rotation.y += dt * 0.15
      mesh.rotation.x = p * Math.PI * 0.6
      mesh.rotation.z = p * 0.4
    }

    // scroll-driven camera dolly + gentle arc, always looking at the object
    const cam = state.camera
    cam.position.z = 4.3 - p * 1.7
    cam.position.y = Math.sin(p * Math.PI) * 0.6
    cam.position.x = p * 0.85
    cam.lookAt(0, 0, 0)
  })

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.15, REDUCED ? 24 : 64]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  )
}

export default function ScrollHero() {
  const root = useRef<HTMLDivElement>(null)
  const scroll = useRef<ScrollState>({ progress: 0 })

  useSmoothScroll()

  useGSAP(
    () => {
      // single source of truth: scrub a plain object the R3F frame loop reads
      gsap.to(scroll.current, {
        progress: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1,
        },
      })

      if (REDUCED) {
        gsap.set('[data-hero-line]', { opacity: 1, yPercent: 0 })
        return
      }

      // kinetic headline reveals per section
      const sections = gsap.utils.toArray<HTMLElement>('[data-hero-section]')
      sections.forEach((section) => {
        const lines = section.querySelectorAll('[data-hero-line]')
        gsap.fromTo(
          lines,
          { yPercent: 120, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            duration: 1,
            ease: 'expo.out',
            stagger: 0.12,
            scrollTrigger: {
              trigger: section,
              start: 'top 70%',
              end: 'bottom 30%',
              toggleActions: 'play reverse play reverse',
            },
          },
        )
      })
    },
    { scope: root },
  )

  return (
    <div ref={root} style={styles.root}>
      {/* fixed WebGL layer behind the scrolling copy */}
      <div style={styles.canvasWrap}>
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, 4.3], fov: 45 }}
        >
          <HeroObject scroll={scroll} />
          <EffectComposer>
            <Bloom
              intensity={1.15}
              luminanceThreshold={0.32}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
          </EffectComposer>
        </Canvas>
      </div>

      {/* scrolling DOM copy layered above the canvas */}
      <div style={styles.copy}>
        <section style={styles.section} data-hero-section>
          <p style={styles.kicker} data-hero-line>
            ATELIER · VOL. 01
          </p>
          <h1 style={styles.headline}>
            <span style={styles.line}>
              <span style={styles.lineInner} data-hero-line>
                FORM IN
              </span>
            </span>
            <span style={styles.line}>
              <span style={{ ...styles.lineInner, ...styles.gradient }} data-hero-line>
                FLUX
              </span>
            </span>
          </h1>
        </section>

        <section style={styles.section} data-hero-section>
          <h2 style={styles.subhead}>
            <span style={styles.line}>
              <span style={styles.lineInner} data-hero-line>
                LIGHT BENT
              </span>
            </span>
            <span style={styles.line}>
              <span style={{ ...styles.lineInner, ...styles.gradient }} data-hero-line>
                THROUGH NOISE
              </span>
            </span>
          </h2>
        </section>

        <section style={{ ...styles.section, ...styles.sectionEnd }} data-hero-section>
          <h2 style={styles.subhead}>
            <span style={styles.line}>
              <span style={{ ...styles.lineInner, ...styles.gradient }} data-hero-line>
                ITERATE
              </span>
            </span>
            <span style={styles.line}>
              <span style={styles.lineInner} data-hero-line>
                THE SUBLIME
              </span>
            </span>
          </h2>
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '320vh',
    background:
      'radial-gradient(120% 80% at 50% 0%, #15103a 0%, #0a0a1f 45%, #050509 100%)',
    color: '#f4f1ff',
    fontFamily:
      "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  canvasWrap: {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 0,
    pointerEvents: 'none',
  },
  copy: {
    position: 'relative',
    zIndex: 1,
    pointerEvents: 'none',
  },
  section: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: 'clamp(1.5rem, 6vw, 8rem)',
  },
  sectionEnd: {
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  kicker: {
    margin: '0 0 1.2rem',
    fontSize: 'clamp(0.7rem, 1vw, 0.95rem)',
    letterSpacing: '0.6em',
    textTransform: 'uppercase',
    color: 'rgba(196, 184, 255, 0.65)',
  },
  headline: {
    margin: 0,
    fontSize: 'clamp(3.5rem, 14vw, 13rem)',
    fontWeight: 800,
    lineHeight: 0.92,
    letterSpacing: '-0.04em',
  },
  subhead: {
    margin: 0,
    fontSize: 'clamp(2.2rem, 8vw, 7rem)',
    fontWeight: 700,
    lineHeight: 0.95,
    letterSpacing: '-0.03em',
  },
  line: {
    display: 'block',
    overflow: 'hidden',
  },
  lineInner: {
    display: 'block',
    willChange: 'transform, opacity',
  },
  gradient: {
    background:
      'linear-gradient(96deg, #8a7bff 0%, #58e6ff 38%, #ff7bd5 72%, #ffd27b 100%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  },
}
