import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { getAdminKey, setAdminKey } from './api'

export default function Layout() {
  const [keyInput, setKeyInput] = useState(getAdminKey())

  return (
    <div className="app-shell">
      <nav>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Repositories
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => (isActive ? 'active' : '')}>
          Review logs
        </NavLink>
        <NavLink to="/commit-reviews" className={({ isActive }) => (isActive ? 'active' : '')}>
          Commit reviews
        </NavLink>
        <span style={{ flex: 1 }} />
        <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Admin key</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="X-Admin-Key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ width: 220 }}
          />
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 0 }}
            onClick={() => {
              setAdminKey(keyInput.trim())
              setKeyInput(getAdminKey())
            }}
          >
            Save
          </button>
        </label>
      </nav>
      <Outlet />
    </div>
  )
}
