import { useEffect } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * Unified-RAF smooth scroll: Lenis drives a single rAF tick via GSAP's ticker,
 * and ScrollTrigger.update is bound to Lenis scroll. This eliminates the
 * 1-frame lag that plagues naive Lenis+GSAP setups. Respects reduced motion.
 *
 * Returns the Lenis instance for imperative control if needed.
 */
export function useSmoothScroll(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
    lenis.on('scroll', ScrollTrigger.update)

    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
    }
  }, [enabled])
}
