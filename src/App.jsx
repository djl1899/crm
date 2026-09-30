import { Router, useLocation, matchPath } from './lib/router.jsx';
import { AuthProvider, LookupProvider, useAuth } from './lib/auth.jsx';
import { UiProvider, Spinner, ErrorBox, Empty } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { LoginPage } from './pages/Login.jsx';
import { DashboardPage } from './pages/Dashboard.jsx';
import { CreatorsPage } from './pages/Creators.jsx';
import { CreatorFormPage } from './pages/CreatorForm.jsx';
import { CreatorProfilePage } from './pages/CreatorProfile.jsx';
import { CollaborationsPage } from './pages/Collaborations.jsx';
import { TasksPage } from './pages/Tasks.jsx';
import { OutreachPage } from './pages/Outreach.jsx';
import { ContractsPage } from './pages/Contracts.jsx';
import { FinancePage } from './pages/Finance.jsx';
import { MediaPage } from './pages/Media.jsx';
import { AppHubPage } from './pages/AppHub.jsx';
import { UsersPage } from './pages/Users.jsx';
import { SettingsPage } from './pages/Settings.jsx';

const ROUTES = [
  ['/', DashboardPage],
  ['/creators', CreatorsPage],
  ['/creators/new', CreatorFormPage],
  ['/creators/:id/edit', CreatorFormPage],
  ['/creators/:id', CreatorProfilePage],
  ['/collaborations', CollaborationsPage],
  ['/tasks', TasksPage],
  ['/outreach', OutreachPage],
  ['/contracts', ContractsPage],
  ['/finance', FinancePage],
  ['/media', MediaPage],
  ['/app', AppHubPage],
  ['/users', UsersPage],
  ['/settings', SettingsPage],
];

function Routes() {
  const { pathname } = useLocation();
  for (const [pattern, Page] of ROUTES) {
    const params = matchPath(pattern, pathname);
    if (params) return <Page key={pattern + JSON.stringify(params)} params={params} />;
  }
  return <Empty icon="alert" title="Seite nicht gefunden" text="Diese Seite existiert nicht." />;
}

function Gate() {
  const auth = useAuth();
  if (auth.loading) return <div className="fullscreen-center"><Spinner label="Lade…" /></div>;
  if (auth.error) {
    return (
      <div className="fullscreen-center">
        <div style={{ maxWidth: 520 }}>
          <ErrorBox error={auth.error} onRetry={auth.refresh} />
        </div>
      </div>
    );
  }
  if (!auth.user) return <LoginPage />;
  return (
    <LookupProvider>
      <Layout>
        <Routes />
      </Layout>
    </LookupProvider>
  );
}

export function App() {
  return (
    <Router>
      <UiProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </UiProvider>
    </Router>
  );
}
