import React, { createContext, useContext, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import type { Project } from '@shared/types'
import Home from './pages/Home'
import Masker from './pages/Masker'
import OCRRun from './pages/OCRRun'
import Config from './pages/Config'
import Review from './pages/Review'
import Export from './pages/Export'

interface ProjectContextValue {
  project: Project | null
  setProject: (p: Project | null) => void
  saveProject: (p: Project) => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue>({
  project: null,
  setProject: () => {},
  saveProject: async () => {}
})

export const useProject = (): ProjectContextValue => useContext(ProjectContext)

export default function App(): React.JSX.Element {
  const [project, setProjectState] = useState<Project | null>(null)
  const navigate = useNavigate()

  const setProject = (p: Project | null): void => {
    setProjectState(p)
    if (p) navigate('/masker')
    else navigate('/')
  }

  const saveProject = async (p: Project): Promise<void> => {
    await window.api.saveProject(p)
    setProjectState(p)
  }

  return (
    <ProjectContext.Provider value={{ project, setProject, saveProject }}>
      <div className="h-screen flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/masker" element={<Masker />} />
          <Route path="/ocr" element={<OCRRun />} />
          <Route path="/config" element={<Config />} />
          <Route path="/review" element={<Review />} />
          <Route path="/export" element={<Export />} />
        </Routes>
      </div>
    </ProjectContext.Provider>
  )
}
