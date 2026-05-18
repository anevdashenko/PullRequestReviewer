import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './Layout'
import ReposPage from './pages/ReposPage'
import RulesPage from './pages/RulesPage'
import LogsPage from './pages/LogsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ReposPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="repos/:id/rules" element={<RulesPage />} />
        <Route path="repos/:repoId/logs" element={<LogsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
