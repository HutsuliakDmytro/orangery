import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@orangery/ui-kit'
import { App } from './app/app'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found in index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
