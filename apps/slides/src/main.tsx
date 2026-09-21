import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@orangery/ui-kit'
import { App } from './app/app'
import { ShowWindow } from './app/show-window'
import './styles/global.css'

/**
 * Which window this is.
 *
 * A show and a presenter view are windows of their own — a webview cannot be in
 * two places, and a presenter view drawn over the editor is one the room can
 * see — and they are the same bundle opened at a different route.
 */
const route = window.location.hash.replace(/^#/u, '')

const root = document.getElementById('root')
if (!root) throw new Error('#root not found in index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      {route === 'show' ? (
        <ShowWindow presenter={false} />
      ) : route === 'presenter' ? (
        <ShowWindow presenter />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
)
