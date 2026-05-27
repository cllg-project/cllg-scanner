import React, { createContext, useContext, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import type { Project } from '@shared/types'
import Home from './pages/Home'
import Masker from './pages/Masker'
import OCRRun from './pages/OCRRun'
import Config from './pages/Config'
import Review from './pages/Review'
import Export from './pages/Export'
import TourOverlay from './components/TourOverlay'
import { useTour } from './hooks/useTour'
import type { TourState } from './hooks/useTour'
import { TOUR_DEMO_ID } from './data/tourDemoProject'

interface ProjectContextValue {
  project: Project | null
  setProject: (p: Project | null) => void
  /** Set project without triggering navigation (used by tour) */
  setProjectSilent: (p: Project | null) => void
  saveProject: (p: Project) => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue>({
  project: null,
  setProject: () => {},
  setProjectSilent: () => {},
  saveProject: async () => {},
})

export const useProject = (): ProjectContextValue => useContext(ProjectContext)

const TourContext = createContext<TourState>({
  active: false,
  stepIndex: 0,
  start: () => {},
  next: () => {},
  prev: () => {},
  skip: () => {},
  total: 0,
})

export const useTourContext = (): TourState => useContext(TourContext)

export default function App(): React.JSX.Element {
  const [project, setProjectState] = useState<Project | null>(null)
  const navigate = useNavigate()
  const tour = useTour()

  const setProject = (p: Project | null): void => {
    setProjectState(p)
    if (p) navigate('/masker')
    else navigate('/')
  }

  const setProjectSilent = (p: Project | null): void => {
    setProjectState(p)
  }

  const saveProject = async (p: Project): Promise<void> => {
    if (p.id === TOUR_DEMO_ID) return   // never write the demo project to disk
    await window.api.saveProject(p)
    setProjectState(p)
  }

  return (
    <TourContext.Provider value={tour}>
      <ProjectContext.Provider value={{ project, setProject, setProjectSilent, saveProject }}>
        <div className="h-screen flex flex-col">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/masker" element={<Masker />} />
            <Route path="/ocr" element={<OCRRun />} />
            <Route path="/config" element={<Config />} />
            <Route path="/review" element={<Review />} />
            <Route path="/export" element={<Export />} />
          </Routes>
          <TourOverlay tour={tour} />
        </div>
      </ProjectContext.Provider>
    </TourContext.Provider>
  )
}
