import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppsHomePage } from '../apps/AppsHomePage';
import { QaApplicationPage } from '../apps/QaApplicationPage';
import { AppShell } from '../components/AppShell';
import { usePrototype } from '../context/PrototypeContext';
import ChatPage from '../pages/ChatPage';
import DashboardPage from '../pages/DashboardPage';
import { ImportWizardPage } from '../pages/ImportWizardPage';
import { KnowledgeBaseDetailPage } from '../pages/KnowledgeBaseDetailPage';
import { KnowledgeBaseListPage } from '../pages/KnowledgeBaseListPage';
import { ModelSettingsPage } from '../pages/ModelSettingsPage';
import RoleSelectPage from '../pages/RoleSelectPage';
import type { Role } from '../types';
import { roleHome } from './roles';

const ObservabilityPage = lazy(() => import('../observability/ObservabilityPage'));
const EvaluationsPage = lazy(() => import('../evaluations/EvaluationsPage'));

function EvaluationsRoute() {
  return <RoleGate allow={['admin']}><Suspense fallback={<div className="app-page">正在加载评测集…</div>}><EvaluationsPage /></Suspense></RoleGate>;
}

function ObservabilityRoute() {
  return <RoleGate allow={['admin', 'manager']}><Suspense fallback={<div className="app-page">正在加载可观测中心…</div>}><ObservabilityPage /></Suspense></RoleGate>;
}

function GuardedShell() {
  const { role } = usePrototype();
  if (!role) return <Navigate to="/roles" replace />;
  return <AppShell />;
}

function RoleGate({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { role } = usePrototype();
  if (!role || !allow.includes(role)) {
    return <Navigate to={roleHome(role)} replace />;
  }
  return children;
}

function RoleHomeRedirect() {
  const { role } = usePrototype();
  return <Navigate to={roleHome(role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/roles" element={<RoleSelectPage />} />
      <Route element={<GuardedShell />}>
        <Route
          path="/dashboard"
          element={
            <RoleGate allow={['admin', 'manager']}>
              <DashboardPage />
            </RoleGate>
          }
        />
        <Route
          path="/knowledge"
          element={
            <RoleGate allow={['admin', 'manager']}>
              <KnowledgeBaseListPage />
            </RoleGate>
          }
        />
        <Route
          path="/knowledge/:id/import"
          element={
            <RoleGate allow={['admin', 'manager']}>
              <ImportWizardPage />
            </RoleGate>
          }
        />
        <Route
          path="/knowledge/:id"
          element={
            <RoleGate allow={['admin', 'manager']}>
              <KnowledgeBaseDetailPage />
            </RoleGate>
          }
        />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/apps" element={<AppsHomePage />} />
        <Route path="/apps/:scenarioId" element={<QaApplicationPage />} />
        <Route
          path="/settings/models"
          element={
            <RoleGate allow={['admin']}>
              <ModelSettingsPage />
            </RoleGate>
          }
        />
        <Route
          path="/logs"
          element={
            <RoleGate allow={['admin']}>
              <Navigate to="/observability/overview" replace />
            </RoleGate>
          }
        />
        <Route path="/observability/:view/:runId?" element={<ObservabilityRoute />} />
        <Route path="/evaluations" element={<EvaluationsRoute />} />
        <Route path="/evaluations/datasets/:datasetId" element={<EvaluationsRoute />} />
        <Route path="/evaluations/cases/:caseId" element={<EvaluationsRoute />} />
        <Route path="/observability" element={<RoleGate allow={['admin', 'manager']}><Navigate to="/observability/overview" replace /></RoleGate>} />
      </Route>
      <Route path="/" element={<RoleHomeRedirect />} />
      <Route path="*" element={<RoleHomeRedirect />} />
    </Routes>
  );
}
