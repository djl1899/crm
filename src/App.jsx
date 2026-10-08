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
import { UsersPage } from './pages/Users.jsx';
import { SettingsPage } from './pages/Settings.jsx';
import { GuidesPage, GuideViewPage } from './pages/Guides.jsx';
import { InvitePage } from './pages/Invite.jsx';
import { PortalApp } from './portal/Portal.jsx';
import { ListsPage } from './pages/Lists.jsx';

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
  ['/users', UsersPage],
  ['/settings', SettingsPage],
  ['/listen', ListsPage],
  ['/listen/:id', ListsPage],
  ['/leitfaeden', GuidesPage],
  ['/leitfaeden/:slug', GuideViewPage],
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
  const { pathname } = useLocation();
  // Einladungslink für Creator funktioniert immer – auch wenn gerade jemand anderes eingeloggt ist
  if (pathname === '/einladung') return <InvitePage />;
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
  if (auth.user.role === 'creator') return <PortalApp agencyName={auth.agencyName} />;
  // Team: Creator-Ansicht als Vorschau (nur lesend)
  const preview = pathname.match(/^\/creators\/(\d+)\/ansicht(\/.*)?$/);
  if (preview) return <PortalApp key={preview[1]} agencyName={auth.agencyName} previewId={Number(preview[1])} />;
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
