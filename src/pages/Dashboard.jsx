import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { Card, Stat, Spinner, ErrorBox, Empty, StatusBadge, Badge } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { fmtMoney, fmtNumber, fmtDate, fmtDue, fmtRelative, fmtDateTime } from '../lib/format.js';

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi('/dashboard');
  if (loading && !data) return <Spinner label="Dashboard wird geladen…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const k = data.kpi;
  const dueFollowups = k.followups_today + k.followups_overdue;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <Stat icon="send" label="Follow-ups fällig" value={dueFollowups} tone={k.followups_overdue ? 'red' : dueFollowups ? 'amber' : undefined}
          hint={`${k.followups_overdue} überfällig · ${k.followups_today} heute`} to="/outreach?tab=followups&range=due" />
        <Stat icon="tasks" label="Offene Aufgaben" value={k.tasks_open} tone={k.tasks_overdue ? 'red' : undefined}
          hint={`${k.tasks_overdue} überfällig · ${k.tasks_today} heute`} to="/tasks?view=open" />
        <Stat icon="briefcase" label="Aktive Kooperationen" value={k.collabs_active} hint={`${k.collabs_planned} geplant · ${k.collabs_pipeline} in Anbahnung`} to="/collaborations?status_group=active" />
        <Stat icon="euro" label="Umsatz aktueller Monat" value={fmtMoney(k.revenue_month)} hint={`${fmtMoney(k.revenue_year)} dieses Jahr`} to="/finance" />
      </div>

      <div className="dash-grid">
        <div className="dash-main">
          <Card title="Follow-ups" subtitle="Überfällig, heute und nächste 7 Tage" actions={<Link to="/outreach?tab=followups" className="link">Alle</Link>} padded={false}>
            {!data.followups.length ? (
              <Empty icon="check" title="Keine offenen Follow-ups" text="Alles erledigt für die nächsten 7 Tage." />
            ) : (
              <ul className="list">
                {data.followups.map((f) => (
                  <li key={f.id}>
                    <Link to={`/creators/${f.creator_id}?tab=outreach`} className="list-row">
                      <span className={`due-pill ${f.overdue ? 'overdue' : f.today ? 'today' : ''}`}>{fmtDue(f.follow_up_date)}</span>
                      <div className="list-main">
                        <div className="list-title">{f.creator_name}</div>
                        <div className="list-sub">{[f.channel, f.subject || f.result, f.user_name].filter(Boolean).join(' · ')}</div>
                      </div>
                      <Icon name="chevronRight" size={16} className="muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Anstehende Aufgaben" actions={<Link to="/tasks?view=open" className="link">Alle</Link>} padded={false}>
            {!data.tasks.length ? (
              <Empty icon="check" title="Keine offenen Aufgaben" />
            ) : (
              <ul className="list">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tasks?open=${t.id}`} className="list-row">
                      <span className={`due-pill ${t.overdue ? 'overdue' : fmtDue(t.due_date) === 'heute' ? 'today' : ''}`}>{t.due_date ? fmtDue(t.due_date) : 'ohne Datum'}</span>
                      <div className="list-main">
                        <div className="list-title">{t.title}</div>
                        <div className="list-sub">{[t.creator_name, t.assignee_name].filter(Boolean).join(' · ') || '–'}</div>
                      </div>
                      <StatusBadge value={t.priority} dot={false} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Kommende Deadlines" subtitle="Kooperationen" actions={<Link to="/collaborations?deadline=upcoming" className="link">Alle</Link>} padded={false}>
            {!data.deadlines.length ? (
              <Empty icon="calendar" title="Keine anstehenden Deadlines" />
            ) : (
              <ul className="list">
                {data.deadlines.map((d) => (
                  <li key={d.id}>
                    <Link to={`/collaborations?open=${d.id}`} className="list-row">
                      <span className="due-pill">{fmtDue(d.deadline)}</span>
                      <div className="list-main">
                        <div className="list-title">{d.brand}{d.campaign_name ? ` – ${d.campaign_name}` : ''}</div>
                        <div className="list-sub">{d.creator_name} · {fmtDate(d.deadline)}</div>
                      </div>
                      <StatusBadge value={d.status} dot={false} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="dash-side">
          <Card title="Kennzahlen" padded={false}>
            <div className="kpi-groups">
              <KpiGroup title="Creator" items={[
                ['Gesamt', k.creators_total, '/creators?archived=include'],
                ['Neu (30 Tage)', k.creators_new, '/creators?sort=created'],
                ['Aktiv', k.creators_active, '/creators?status=Aktiv'],
                ['Pausiert', k.creators_paused, '/creators?status=Pausiert'],
                ['Archiviert', k.creators_archived, '/creators?archived=only'],
                ['Nicht angeschrieben', k.creators_not_contacted, '/creators?contacted=no'],
              ]} />
              <KpiGroup title="Outreach" items={[
                ['Noch nicht kontaktiert', k.outreach_not_contacted, '/creators?outreach_status=Noch nicht kontaktiert'],
                ['Kontaktiert', k.outreach_contacted, '/creators?contacted=yes'],
                ['Antwort ausstehend', k.outreach_awaiting, '/creators?outreach_status=Kontaktiert'],
                ['Follow-ups heute', k.followups_today, '/outreach?tab=followups&range=today'],
                ['Überfällige Follow-ups', k.followups_overdue, '/outreach?tab=followups&range=overdue', k.followups_overdue ? 'red' : null],
                ['Nächste 7 Tage', k.followups_week, '/outreach?tab=followups&range=week'],
              ]} />
              <KpiGroup title="Kooperationen" items={[
                ['Aktiv', k.collabs_active, '/collaborations?status_group=active'],
                ['Geplant', k.collabs_planned, '/collaborations?status=Geplant'],
                ['Abgeschlossen', k.collabs_completed, '/collaborations?status=Abgeschlossen'],
              ]} />
              <KpiGroup title="Aufgaben" items={[
                ['Offen', k.tasks_open, '/tasks?view=open'],
                ['Heute fällig', k.tasks_today, '/tasks?view=today'],
                ['Überfällig', k.tasks_overdue, '/tasks?view=overdue', k.tasks_overdue ? 'red' : null],
              ]} />
              <KpiGroup title="Verträge" items={[
                ['Aktive Verträge', k.contracts_active, '/contracts?status=Aktiv'],
                ['Laufen bald aus', k.contracts_expiring, '/contracts?expiring=1', k.contracts_expiring ? 'amber' : null],
                ['Creator ohne Vertrag', k.creators_without_contract, '/contracts?status=Kein Vertrag'],
              ]} />
              <KpiGroup title="Finanzen" items={[
                ['Gesamtumsatz', fmtMoney(k.revenue_total), '/finance'],
                ['Aktueller Monat', fmtMoney(k.revenue_month), '/finance'],
                ['Aktuelles Jahr', fmtMoney(k.revenue_year), '/finance'],
              ]} />
            </div>
          </Card>

          <Card title="Zuletzt kontaktiert" padded={false}>
            {!data.recent_contacts.length ? (
              <Empty icon="send" title="Noch keine Kontakte erfasst" />
            ) : (
              <ul className="list">
                {data.recent_contacts.map((c) => (
                  <li key={c.id}>
                    <Link to={`/creators/${c.creator_id}?tab=outreach`} className="list-row">
                      <div className="list-main">
                        <div className="list-title">{c.creator_name}</div>
                        <div className="list-sub">{[c.channel, c.result, c.user_name].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className="muted small" title={fmtDateTime(c.occurred_at)}>{fmtRelative(c.occurred_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Aktivitäten" padded={false}>
            <ActivityFeed items={data.activities} showCreator />
          </Card>
        </div>
      </div>
    </div>
  );
}

function KpiGroup({ title, items }) {
  return (
    <div className="kpi-group">
      <div className="kpi-group-title">{title}</div>
      {items.map(([label, value, to, tone]) => (
        <Link key={label} to={to} className="kpi-line">
          <span>{label}</span>
          <strong className={tone ? 'tone-' + tone : ''}>{typeof value === 'number' ? fmtNumber(value) : value}</strong>
        </Link>
      ))}
    </div>
  );
}

const ACTION_ICONS = {
  creator_created: 'plus', creator_contacted: 'send', creator_status_changed: 'activity', outreach_status_changed: 'send',
  collaboration_created: 'briefcase', task_completed: 'check', task_created: 'tasks', contract_uploaded: 'file',
  document_uploaded: 'upload', creator_archived: 'archive', contract_status_changed: 'file', followup_set: 'calendar',
};

export function ActivityFeed({ items, showCreator = false }) {
  if (!items?.length) return <Empty icon="activity" title="Noch keine Aktivitäten" />;
  return (
    <ul className="feed">
      {items.map((a) => (
        <li key={a.id} className="feed-item">
          <span className="feed-icon"><Icon name={ACTION_ICONS[a.action] || 'activity'} size={14} /></span>
          <div className="feed-body">
            <div>
              <strong>{a.user_name || 'System'}</strong> {a.message}
              {showCreator && a.creator_id && a.creator_name && (
                <> · <Link to={`/creators/${a.creator_id}`} className="link">{a.creator_name}</Link></>
              )}
            </div>
            <div className="feed-time" title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

