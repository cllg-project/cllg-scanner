import { useState, useCallback } from 'react'
import { TOUR_STEPS } from '../data/tourSteps'

export interface TourState {
  active: boolean
  stepIndex: number
  start: () => void
  next: () => void
  prev: () => void
  skip: () => void
  total: number
}

export function useTour(): TourState {
  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  const start = useCallback(() => {
    setStepIndex(0)
    setActive(true)
  }, [])

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i < TOUR_STEPS.length - 1) return i + 1
      setActive(false)
      return 0
    })
  }, [])

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const skip = useCallback(() => {
    setActive(false)
  }, [])

  return { active, stepIndex, start, next, prev, skip, total: TOUR_STEPS.length }
}
