import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

const cards = [
  ['01', 'Magnetic cards', 'Pointer-driven spring transforms, no React state per frame.'],
  ['02', 'Premium entry', 'Blur resolves, expo-out timing, staggered hierarchy.'],
  ['03', 'Reduced risk', 'Lightweight DOM motion while WebGL routes stay optional.'],
]

function Card({ i, title, body }: { i: string; title: string; body: string }) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 180, damping: 22 })
  const sy = useSpring(y, { stiffness: 180, damping: 22 })
  const rotateX = useTransform(sy, [-40, 40], [8, -8])
  const rotateY = useTransform(sx, [-40, 40], [-10, 10])

  return (
    <motion.article
      initial={{ opacity: 0, y: 34, filter: 'blur(14px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.8, delay: Number(i) * 0.08, ease: [0.16, 1, 0.3, 1] }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        x.set((event.clientX - rect.left - rect.width / 2) * 0.16)
        y.set((event.clientY - rect.top - rect.height / 2) * 0.16)
      }}
      onPointerLeave={() => { x.set(0); y.set(0) }}
      style={{
        x: sx,
        y: sy,
        rotateX,
        rotateY,
        transformPerspective: 900,
        minHeight: 230,
        padding: 28,
        borderRadius: 30,
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'linear-gradient(145deg, rgba(255,255,255,0.16), rgba(255,255,255,0.045))',
        boxShadow: '0 40px 140px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.14)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.28em', opacity: 0.55 }}>{i}</div>
      <h2 style={{ fontSize: 'clamp(28px, 3.2vw, 46px)', letterSpacing: '-0.055em', lineHeight: 0.95, margin: '58px 0 14px' }}>{title}</h2>
      <p style={{ opacity: 0.68, lineHeight: 1.6, margin: 0 }}>{body}</p>
    </motion.article>
  )
}

export default function KineticDeck() {
  return (
    <main style={{ minHeight: '100vh', color: '#fff6e8', overflow: 'hidden', background: 'radial-gradient(circle at 80% 10%, rgba(255,96,177,0.28), transparent 28%), radial-gradient(circle at 20% 80%, rgba(83,172,255,0.24), transparent 32%), #07070c' }}>
      <div style={{ position: 'fixed', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '64px 64px', maskImage: 'radial-gradient(circle at 50% 50%, black, transparent 72%)' }} />
      <section style={{ position: 'relative', zIndex: 1, padding: 'clamp(32px, 7vw, 96px)', display: 'grid', alignContent: 'center', minHeight: '100vh' }}>
        <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 0.66, y: 0 }} style={{ letterSpacing: '0.42em', textTransform: 'uppercase', fontSize: 11 }}>Kinetic motion deck</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 28, filter: 'blur(14px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0)' }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} style={{ fontSize: 'clamp(54px, 9vw, 132px)', lineHeight: 0.86, letterSpacing: '-0.085em', maxWidth: 1020, margin: '18px 0 48px' }}>
          Motion should feel expensive before it feels loud.
        </motion.h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, maxWidth: 1120 }}>
          {cards.map(([i, title, body]) => <Card key={i} i={i} title={title} body={body} />)}
        </div>
      </section>
    </main>
  )
}
