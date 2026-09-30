import './installDemoApi'
import '../renderer/src/main'
import React from 'react'
import ReactDOM from 'react-dom/client'
import DemoChrome from './DemoChrome'

const chrome = document.createElement('div')
document.body.appendChild(chrome)
ReactDOM.createRoot(chrome).render(<DemoChrome />)
