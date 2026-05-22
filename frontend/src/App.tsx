import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './Layout'
import ReposPage from './pages/ReposPage'
import RulesPage from './pages/RulesPage'
import LogsPage from './pages/LogsPage'
import LogDetailPage from './pages/LogDetailPage'
import CommitReviewReposPage from './pages/CommitReviewReposPage'
import CommitReviewsListPage from './pages/CommitReviewsListPage'
import CommitReviewDetailPage from './pages/CommitReviewDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<ReposPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="logs/:logId" element={<LogDetailPage />} />
        <Route path="commit-reviews" element={<CommitReviewReposPage />} />
        <Route path="commit-reviews/:repoId" element={<CommitReviewsListPage />} />
        <Route path="commit-reviews/:repoId/:reviewId" element={<CommitReviewDetailPage />} />
        <Route path="repos/:id/rules" element={<RulesPage />} />
        <Route path="repos/:repoId/logs" element={<LogsPage />} />
        <Route path="repos/:repoId/logs/:logId" element={<LogDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
