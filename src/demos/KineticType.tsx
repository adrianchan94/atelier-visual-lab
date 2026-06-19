import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  type MotionValue,
} from 'framer-motion'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { CustomEase } from 'gsap/CustomEase'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP, SplitText, CustomEase)

/* Custom cubic-bezier eases — the entrance signature of the piece. */
CustomEase.create('ktReveal', '0.16, 1, 0.30, 1')
const CURTAIN_EASE: [number, number, number, number] = [0.76, 0, 0.24, 1]

/* View Transitions API is not in the standard TS DOM lib yet. */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>
  }
}

type Route = 'home' | 'work' | 'studio' | 'contact'

interface CursorState {
  scale: number
  label: string
}

const DETAIL: Record<Exclude<Route, 'home'>, { index: string; title: string; copy: string }> = {
  work: {
    index: '01',
    title: 'Selected\nWork',
    copy: 'Interactive systems engineered frame by frame — where typography behaves like material.',
  },
  studio: {
    index: '02',
    title: 'The\nStudio',
    copy: 'A small atelier obsessed with motion, restraint, and the millisecond between intent and response.',
  },
  contact: {
    index: '03',
    title: 'Begin a\nDialogue',
    copy: 'Tell us about the gesture you are chasing. We answer every signal worth the silence.',
  },
}

/* ── Magnetic element ──────────────────────────────────────────────
   Translates toward the pointer on hover (motion values, not state),
   scales on press. Doubles as pill button or inline link. */
function Magnetic(props: {
  label: string
  cursorLabel: string
  variant: 'pill' | 'link'
  strength: number
  reduced: boolean
  onActivate: () => void
  onCursor: (next: CursorState) => void
}) {
  const { label, cursorLabel, variant, strength, reduced, onActivate, onCursor } = props
  const ref = useRef<HTMLButtonElement>(null)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const x = useSpring(mx, { stiffness: 260, damping: 18, mass: 0.5 })
  const y = useSpring(my, { stiffness: 260, damping: 18, mass: 0.5 })

  function handleMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (reduced || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    mx.set((e.clientX - (r.left + r.width / 2)) * strength)
    my.set((e.clientY - (r.top + r.height / 2)) * strength)
  }

  function handleEnter() {
    onCursor({ scale: variant === 'pill' ? 2.6 : 3.4, label: cursorLabel })
  }

  function handleLeave() {
    mx.set(0)
    my.set(0)
    onCursor({ scale: 1, label: '' })
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      className={variant === 'pill' ? 'kt-pill' : 'kt-link'}
      style={{ x, y }}
      onPointerMove={handleMove}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onClick={onActivate}
      whileTap={reduced ? undefined : { scale: 0.93 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      <span className="kt-pill-inner">{label}</span>
    </motion.button>
  )
}

/* ── Blended magnetic cursor ───────────────────────────────────────
   Position is driven entirely by motion values + springs (no React
   state on the hot path). Variant scale/label come from low-frequency
   hover state. */
function Cursor(props: { sx: MotionValue<number>; sy: MotionValue<number>; state: CursorState }) {
  const { sx, sy, state } = props
  return (
    <motion.div className="kt-cursor" style={{ x: sx, y: sy }} aria-hidden>
      <motion.div
        className="kt-cursor-ring"
        animate={{ scale: state.scale }}
        transition={{ type: 'spring', stiffness: 300, damping: 24, mass: 0.4 }}
      />
      <motion.span
        className="kt-cursor-label"
        animate={{ opacity: state.label ? 1 : 0 }}
        transition={{ duration: 0.18 }}
      >
        {state.label}
      </motion.span>
    </motion.div>
  )
}

export default function KineticType() {
  const rootRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)

  const [route, setRoute] = useState<Route>('home')
  const [reduced, setReduced] = useState(false)
  const [cursor, setCursor] = useState<CursorState>({ scale: 1, label: '' })

  // Framer-motion curtain fallback (when View Transitions is unavailable).
  const [curtainOpen, setCurtainOpen] = useState(false)
  const pendingRef = useRef<Route | null>(null)
  const navigatingRef = useRef(false)
  const reducedRef = useRef(false)

  // Pointer position → springs.
  const cx = useMotionValue(-120)
  const cy = useMotionValue(-120)
  const sx = useSpring(cx, { stiffness: 520, damping: 40, mass: 0.6 })
  const sy = useSpring(cy, { stiffness: 520, damping: 40, mass: 0.6 })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setReduced(mq.matches)
      reducedRef.current = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      cx.set(e.clientX)
      cy.set(e.clientY)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [cx, cy])

  // Headline reveal + looping float, re-run whenever the home view mounts.
  useGSAP(
    () => {
      const el = headlineRef.current
      if (!el || route !== 'home') return

      const split = SplitText.create(el, {
        type: 'lines,words,chars',
        mask: 'lines',
        linesClass: 'kt-line',
        charsClass: 'kt-char',
        autoSplit: false,
      })

      if (reducedRef.current) {
        gsap.set(split.chars, { yPercent: 0, opacity: 1 })
        return () => split.revert()
      }

      gsap.set(split.chars, { yPercent: 125, opacity: 0 })
      gsap.to(split.chars, {
        yPercent: 0,
        opacity: 1,
        duration: 1.15,
        ease: 'ktReveal',
        stagger: { each: 0.02, from: 'start' },
        delay: 0.12,
      })
      // Subtle, organic float layered on top (uses `y`, independent of the
      // reveal's `yPercent`, so the two transforms simply sum).
      gsap.to(split.chars, {
        y: -7,
        duration: 2.6,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: 1.5,
        stagger: { each: 0.06, from: 'random' },
      })

      return () => split.revert()
    },
    { scope: rootRef, dependencies: [route, reduced] },
  )

  function navigate(target: Route) {
    if (navigatingRef.current || target === route) return

    if (reducedRef.current) {
      setRoute(target)
      return
    }

    const doc = document as ViewTransitionDocument
    if (typeof doc.startViewTransition === 'function') {
      navigatingRef.current = true
      const transition = doc.startViewTransition(() => {
        flushSync(() => setRoute(target))
      })
      transition.finished.finally(() => {
        navigatingRef.current = false
      })
      return
    }

    // Framer-motion curtain fallback.
    navigatingRef.current = true
    pendingRef.current = target
    setCurtainOpen(true)
  }

  const detail = route === 'home' ? null : DETAIL[route]

  return (
    <div
      ref={rootRef}
      className="kt-root"
      style={{ cursor: reduced ? 'auto' : 'none' } as CSSProperties}
    >
      <style>{CSS}</style>

      <div className="kt-page" style={{ viewTransitionName: 'kt-page' } as CSSProperties}>
        {route === 'home' ? (
          <main className="kt-home">
            <p className="kt-eyebrow">
              Atelier · Kinetic Index <span className="kt-eyebrow-dim">— Vol.04 / MMXXVI</span>
            </p>

            <h1 ref={headlineRef} className="kt-headline">
              Motion is the last luxury
            </h1>

            <p className="kt-lede">
              An editorial study in kinetic typography — every glyph arrives on its own easing
              curve, the cursor answers your hand, and the page turns like a held breath.
            </p>

            <nav className="kt-index" aria-label="Sections">
              <Magnetic
                label="Work"
                cursorLabel="view"
                variant="link"
                strength={0.5}
                reduced={reduced}
                onActivate={() => navigate('work')}
                onCursor={setCursor}
              />
              <span className="kt-index-sep">/</span>
              <Magnetic
                label="Studio"
                cursorLabel="read"
                variant="link"
                strength={0.5}
                reduced={reduced}
                onActivate={() => navigate('studio')}
                onCursor={setCursor}
              />
              <span className="kt-index-sep">/</span>
              <Magnetic
                label="Journal"
                cursorLabel="soon"
                variant="link"
                strength={0.5}
                reduced={reduced}
                onActivate={() => navigate('studio')}
                onCursor={setCursor}
              />
            </nav>

            <div className="kt-actions">
              <Magnetic
                label="View Work"
                cursorLabel="open"
                variant="pill"
                strength={0.4}
                reduced={reduced}
                onActivate={() => navigate('work')}
                onCursor={setCursor}
              />
              <Magnetic
                label="The Studio"
                cursorLabel="open"
                variant="pill"
                strength={0.4}
                reduced={reduced}
                onActivate={() => navigate('studio')}
                onCursor={setCursor}
              />
              <Magnetic
                label="Contact"
                cursorLabel="say hi"
                variant="pill"
                strength={0.4}
                reduced={reduced}
                onActivate={() => navigate('contact')}
                onCursor={setCursor}
              />
            </div>
          </main>
        ) : (
          detail && (
            <main className="kt-detail">
              <span className="kt-detail-index">{detail.index}</span>
              <h2 className="kt-detail-title">
                {detail.title.split('\n').map((line, i) => (
                  <span key={i} className="kt-detail-line">
                    {line}
                  </span>
                ))}
              </h2>
              <p className="kt-detail-copy">{detail.copy}</p>
              <div className="kt-actions">
                <Magnetic
                  label="Return to Index"
                  cursorLabel="back"
                  variant="pill"
                  strength={0.4}
                  reduced={reduced}
                  onActivate={() => navigate('home')}
                  onCursor={setCursor}
                />
              </div>
            </main>
          )
        )}
      </div>

      <AnimatePresence onExitComplete={() => (navigatingRef.current = false)}>
        {curtainOpen && (
          <motion.div
            key="curtain"
            className="kt-curtain"
            initial={{ y: '100%' }}
            animate={{ y: '0%' }}
            exit={{ y: '-100%' }}
            transition={{ duration: 0.62, ease: CURTAIN_EASE }}
            onAnimationComplete={() => {
              if (pendingRef.current !== null) {
                setRoute(pendingRef.current)
                pendingRef.current = null
                setCurtainOpen(false)
              }
            }}
          >
            <span className="kt-curtain-mark">Atelier</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!reduced && <Cursor sx={sx} sy={sy} state={cursor} />}
    </div>
  )
}

const CSS = `
.kt-root {
  position: relative;
  width: 100%;
  min-height: 100svh;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 18% 8%, #14101c 0%, rgba(20,16,28,0) 55%),
    radial-gradient(120% 120% at 100% 100%, #120e16 0%, rgba(18,14,22,0) 50%),
    #08070b;
  color: #efece4;
  --kt-gold: #c8a14e;
  --kt-mute: #8d8896;
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.kt-page {
  position: relative;
  min-height: 100svh;
  display: flex;
  align-items: center;
  padding: clamp(1.5rem, 6vw, 7rem);
  box-sizing: border-box;
}
.kt-home { max-width: 60rem; }

.kt-eyebrow {
  margin: 0 0 clamp(1.4rem, 3vw, 2.6rem);
  font-size: 0.72rem;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--kt-gold);
}
.kt-eyebrow-dim { color: var(--kt-mute); }

.kt-headline {
  margin: 0;
  font-family: 'Canela', 'Georgia', 'Times New Roman', serif;
  font-weight: 400;
  font-size: clamp(3.2rem, 11vw, 9.5rem);
  line-height: 0.94;
  letter-spacing: -0.02em;
  max-width: 14ch;
  color: #f6f3ec;
}
/* SplitText scaffolding — mask line + per-char float layer */
.kt-line { overflow: hidden; padding-bottom: 0.04em; }
.kt-char { display: inline-block; will-change: transform, opacity; }

.kt-lede {
  margin: clamp(1.6rem, 3vw, 2.6rem) 0 0;
  max-width: 42ch;
  font-size: clamp(1rem, 1.4vw, 1.2rem);
  line-height: 1.55;
  color: #b8b3c0;
}

.kt-index {
  margin-top: clamp(2rem, 4vw, 3rem);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Canela', 'Georgia', serif;
}
.kt-index-sep { color: var(--kt-mute); font-size: 1.5rem; }
.kt-link {
  appearance: none;
  border: 0;
  background: transparent;
  color: #efece4;
  font: inherit;
  font-size: clamp(1.5rem, 2.6vw, 2.4rem);
  font-style: italic;
  padding: 0 0.4rem;
  cursor: inherit;
  position: relative;
}
.kt-link .kt-pill-inner { position: relative; }
.kt-link .kt-pill-inner::after {
  content: '';
  position: absolute;
  left: 0; bottom: -0.12em;
  width: 100%; height: 1px;
  background: var(--kt-gold);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.76,0,0.24,1);
}
.kt-link:hover .kt-pill-inner::after { transform: scaleX(1); }

.kt-actions {
  margin-top: clamp(2.4rem, 4vw, 3.4rem);
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
}
.kt-pill {
  appearance: none;
  cursor: inherit;
  border: 1px solid rgba(239,236,228,0.22);
  background: rgba(239,236,228,0.04);
  color: #efece4;
  border-radius: 999px;
  padding: 0.95rem 1.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  backdrop-filter: blur(6px);
  transition: border-color 0.4s ease, background 0.4s ease, color 0.4s ease;
}
.kt-pill:hover {
  border-color: var(--kt-gold);
  background: var(--kt-gold);
  color: #08070b;
}
.kt-pill-inner { display: inline-block; pointer-events: none; }

/* Detail "route" */
.kt-detail { max-width: 54rem; }
.kt-detail-index {
  font-size: 0.75rem;
  letter-spacing: 0.3em;
  color: var(--kt-gold);
}
.kt-detail-title {
  margin: 0.6rem 0 0;
  font-family: 'Canela', 'Georgia', serif;
  font-weight: 400;
  font-size: clamp(3rem, 9vw, 7.5rem);
  line-height: 0.95;
  letter-spacing: -0.02em;
}
.kt-detail-line { display: block; }
.kt-detail-copy {
  margin: 1.6rem 0 0;
  max-width: 40ch;
  font-size: clamp(1rem, 1.4vw, 1.2rem);
  line-height: 1.55;
  color: #b8b3c0;
}

/* Curtain (framer-motion fallback) */
.kt-curtain {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: var(--kt-gold);
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: transform;
}
.kt-curtain-mark {
  font-family: 'Canela', 'Georgia', serif;
  font-style: italic;
  font-size: clamp(2rem, 6vw, 4.5rem);
  color: #08070b;
}

/* Blended magnetic cursor */
.kt-cursor {
  position: fixed;
  top: 0; left: 0;
  width: 0; height: 0;
  z-index: 9999;
  pointer-events: none;
  mix-blend-mode: difference;
  will-change: transform;
}
.kt-cursor-ring {
  position: absolute;
  left: 0; top: 0;
  width: 18px; height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #fff;
  transform-origin: center;
  will-change: transform;
}
.kt-cursor-label {
  position: absolute;
  left: 0; top: 0;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #08070b;
  white-space: nowrap;
}

/* View Transitions API styling (preferred path) — transform/opacity only */
::view-transition-old(kt-page) {
  animation: kt-vt-out 0.55s cubic-bezier(0.76,0,0.24,1) both;
}
::view-transition-new(kt-page) {
  animation: kt-vt-in 0.6s cubic-bezier(0.76,0,0.24,1) both;
}
@keyframes kt-vt-out { to { opacity: 0; transform: translateY(-26px); } }
@keyframes kt-vt-in { from { opacity: 0; transform: translateY(64px); } }

@media (prefers-reduced-motion: reduce) {
  .kt-char { will-change: auto; }
  ::view-transition-old(kt-page),
  ::view-transition-new(kt-page) { animation: none; }
}
`
