import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { useSearchParams } from '../lib/router.jsx';
import { useLookups, useAuth } from '../lib/auth.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, useUi, Card } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { TaskModal, CreatorPicker, AvatarStack, TaskStatusSelect } from '../components/forms.jsx';
import { TaskList, DuePill } from './CreatorProfile.jsx';
import { todayStr } from '../lib/format.js';
import { api as apiClient } from '../lib/api.js';
import { invalidateAll } from '../lib/useApi.js';
import { TASK_PRIORITIES } from '../../shared/constants.js';

// Alte Links (?view=…) aus Dashboard & Co. weiter unterstützen
const LEGACY_VIEWS = { open: { status: 'open' }, today: { due: 'today' }, week: { due: 'week' }, overdue: { due: 'overdue' }, mine: { assignee_id: 'me' } };
const STATUS_FILTER = [
  { value: '', label: 'Alle' },
  { value: 'Offen', label: 'Offen' },
  { value: 'In Bearbeitung', label: 'In Bearbeitung' },
  { value: 'Erledigt', label: 'Erledigt' },
];
const DUE_OPTIONS = [
  { value: 'today', label: 'Heute fällig' },
  { value: 'week', label: 'Diese Woche fällig' },
  { value: 'overdue', label: 'Überfällig' },
  { value: 'upcoming', label: 'Später fällig' },
  { value: 'none', label: 'Ohne Fälligkeit' },
];

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { users } = useLookups();
  const { toast } = useUi();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  const [modal, setModal] = useState(null);
  // Alte Ansicht-Links einmalig in die neuen Filter übersetzen
  useEffect(() => {
    const legacy = LEGACY_VIEWS[params.get('view')];
    if (legacy) setParams({ view: null, ...legacy });
  }, []); // eslint-disable-line

  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line

  const openId = params.get('open');
  useEffect(() => {
    if (!openId) return;
    api.get(`/tasks/${openId}`)
      .then((r) => setModal({ item: r.task }))
      .catch((e) => toast(e.message, 'error'));
  }, [openId]); // eslint-disable-line

  const query = {};
  for (const k of ['q', 'status', 'due', 'assignee_id', 'priority', 'creator_id']) if (params.get(k)) query[k] = params.get(k);
  const { data, error, loading, reload } = useApi('/tasks' + qs({ ...query, page_size: 200 }));
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('tasks-layout') || 'list'; } catch { return 'list'; } });
  useEffect(() => { try { localStorage.setItem('tasks-layout', layout); } catch { /* egal */ } }, [layout]);
  const counts = data?.status_counts;
  const statusValue = params.get('status') === 'open' ? 'open' : params.get('status') || '';
  const setFilter = (key) => (e) => setParams({ [key]: e?.target ? e.target.value : e, page: null });
  const close = () => {
    setModal(null);
    if (openId) setParams({ open: null });
  };

  return (
    <div className="page">
      <PageHeader
        title="Aufgaben"
        subtitle={data ? <Summary items={data.items} /> : null}
        actions={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neue Aufgabe</Button>}
      />
      <div className="filters card">
        <div className="filter-row tasks-toprow">
          <Segmented
            value={statusValue}
            onChange={(v) => setParams({ status: v || null, page: null })}
            options={[
              ...STATUS_FILTER.map((o) => ({ ...o, count: counts ? counts[o.value || 'Alle'] : undefined })),
              ...(statusValue === 'open' ? [{ value: 'open', label: 'Offen + In Bearbeitung' }] : []),
            ]}
          />
          <div className="layout-toggle" role="group" aria-label="Darstellung">
            <button type="button" className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-pressed={layout === 'list'}><Icon name="tasks" size={15} /> Liste</button>
            <button type="button" className={layout === 'board' ? 'active' : ''} onClick={() => setLayout('board')} aria-pressed={layout === 'board'}><Icon name="dashboard" size={15} /> Board</button>
          </div>
        </div>
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Aufgabe oder Creator suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('due')} onChange={setFilter('due')} placeholder="Jede Fälligkeit" options={DUE_OPTIONS} />
          <Select value={params.get('assignee_id')} onChange={setFilter('assignee_id')} placeholder="Alle Verantwortlichen"
            options={[{ value: 'me', label: 'Meine Aufgaben' }, { value: 'none', label: '– nicht zugewiesen –' }, ...users.map((u) => ({ value: String(u.id), label: u.name }))]} />
          <Select value={params.get('priority')} onChange={setFilter('priority')} placeholder="Alle Prioritäten" options={TASK_PRIORITIES} />
          <div className="filter-creator">
            <CreatorPicker key={params.get('creator_id') || 'none'} value={params.get('creator_id')} initialLabel={params.get('creator_name') || ''}
              onChange={(id, label) => setParams({ creator_id: id, creator_name: id ? label : null, page: null })} />
          </div>
          {params.get('creator_id') && <Button variant="ghost" onClick={() => setParams({ creator_id: null, creator_name: null })}>Creator-Filter entfernen</Button>}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? <Spinner /> : data && !data.items.length ? (
        <div className="card"><Empty icon="check" title="Keine Aufgaben in dieser Ansicht" text={params.get('status') ? `Keine Aufgaben mit Status „${params.get('status') === 'open' ? 'offen' : params.get('status')}“ – Filter oben anpassen.` : 'Lege mit „Neue Aufgabe“ die erste an.'} /></div>
      ) : data ? (
        <div className={loading ? 'is-loading' : ''}>
          {layout === 'board'
            ? <TaskBoard items={data.items} onOpen={(t) => setModal({ item: t })} />
            : <GroupedTasks items={data.items} expandDone={params.get('status') === 'Erledigt'} onOpen={(t) => setModal({ item: t })} />}
          {data.total > data.items.length && <p className="small muted tasks-more">Es werden die ersten {data.items.length} von {data.total} Aufgaben angezeigt – grenze sie mit den Filtern ein.</p>}
        </div>
      ) : null}
      <TaskModal open={!!modal} onClose={close} task={modal?.item} />
    </div>
  );
}

// ------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const longDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function dayDiff(iso) {
  return Math.round((new Date(iso + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 864e5);
}

function Summary({ items }) {
  const open = items.filter((t) => t.status !== 'Erledigt');
  const over = open.filter((t) => t.due_date && dayDiff(t.due_date) < 0).length;
  const today = open.filter((t) => t.due_date && dayDiff(t.due_date) === 0).length;
  const doing = open.filter((t) => t.status === 'In Bearbeitung').length;
  if (!open.length) return <span>Alles erledigt in dieser Ansicht.</span>;
  const parts = [];
  if (over) parts.push(<strong key="o" className="sum-over">{over} überfällig</strong>);
  if (today) parts.push(<strong key="t">{today} heute fällig</strong>);
  if (doing) parts.push(<span key="d">{doing} in Bearbeitung</span>);
  parts.push(<span key="a">{open.length} offen insgesamt</span>);
  return <span className="tasks-summary">{parts.reduce((acc, p, i) => (i ? [...acc, ', ', p] : [p]), [])}.</span>;
}

function groupKey(t) {
  if (t.status === 'Erledigt') return 'done';
  if (!t.due_date) return 'none';
  const d = dayDiff(t.due_date);
  if (d < 0) return 'over';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  const now = new Date();
  const daysToSunday = 7 - ((now.getDay() + 6) % 7) - 1;
  return d <= daysToSunday ? 'week' : 'later';
}

function GroupedTasks({ items, onOpen, expandDone }) {
  const [showDone, setShowDone] = useState(expandDone);
  useEffect(() => setShowDone(expandDone), [expandDone]);
  const today = todayStr();
  const tomorrow = isoOf(new Date(Date.now() + 864e5));
  const sunday = (() => { const n = new Date(); n.setDate(n.getDate() + (7 - ((n.getDay() + 6) % 7) - 1)); return isoOf(n); })();
  const GROUPS = [
    { key: 'over', label: 'Überfällig', sub: 'bitte zuerst erledigen' },
    { key: 'today', label: 'Heute', sub: longDate(today) },
    { key: 'tomorrow', label: 'Morgen', sub: longDate(tomorrow) },
    { key: 'week', label: 'Diese Woche', sub: `bis ${shortDate(sunday)}` },
    { key: 'later', label: 'Später', sub: 'ab nächster Woche' },
    { key: 'none', label: 'Ohne Datum', sub: 'irgendwann erledigen' },
    { key: 'done', label: 'Erledigt', sub: 'zuletzt abgeschlossen' },
  ];
  const by = {};
  for (const t of items) (by[groupKey(t)] ||= []).push(t);
  if (by.done) by.done.sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
  return (
    <div className="task-groups">
      {GROUPS.filter((g) => by[g.key]?.length).map((g) => {
        const list = by[g.key];
        const collapsed = g.key === 'done' && !showDone && items.some((t) => t.status !== 'Erledigt');
        return (
          <section key={g.key} className={`task-group g-${g.key}`}>
            <header className="task-group-head">
              <h2>{g.label}</h2>
              <span className="task-group-count">{list.length}</span>
              <span className="task-group-sub">{g.sub}</span>
            </header>
            <div className="task-group-body card">
              {collapsed ? (
                <button className="task-group-reveal" onClick={() => setShowDone(true)}>
                  {list.length} erledigte {list.length === 1 ? 'Aufgabe' : 'Aufgaben'} anzeigen
                </button>
              ) : <TaskList items={list} showCreator onOpen={onOpen} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
const COLUMNS = [
  { status: 'Offen', hint: 'Noch nicht angefangen' },
  { status: 'In Bearbeitung', hint: 'Läuft gerade' },
  { status: 'Erledigt', hint: 'Fertig' },
];

function TaskBoard({ items, onOpen }) {
  const { toast } = useUi();
  const [local, setLocal] = useState({});
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [doneLimit, setDoneLimit] = useState(20);
  useEffect(() => setLocal({}), [items]);
  const statusOf = (t) => local[t.id] || t.status;
  const move = async (t, status) => {
    if (!t || statusOf(t) === status) return;
    setLocal((x) => ({ ...x, [t.id]: status }));
    try {
      await apiClient.patch(`/tasks/${t.id}`, { status });
      invalidateAll();
    } catch (err) {
      setLocal((x) => ({ ...x, [t.id]: t.status }));
      toast(err.message, 'error');
    }
  };
  const sortOpen = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999');
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        let list = items.filter((t) => statusOf(t) === col.status);
        list = col.status === 'Erledigt'
          ? list.sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
          : list.sort(sortOpen);
        const shown = col.status === 'Erledigt' ? list.slice(0, doneLimit) : list;
        return (
          <section key={col.status} className={`board-col s-${col.status === 'Offen' ? 'open' : col.status === 'Erledigt' ? 'done' : 'doing'} ${over === col.status ? 'drop' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.status); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); move(items.find((t) => t.id === dragId), col.status); setDragId(null); }}>
            <header className="board-head">
              <span className="board-dot" />
              <h2>{col.status}</h2>
              <span className="task-group-count">{list.length}</span>
            </header>
            <div className="board-list">
              {!list.length && <div className="board-empty">{over === col.status ? 'Hier ablegen' : col.status === 'Erledigt' ? 'Noch nichts erledigt' : 'Keine Aufgaben'}</div>}
              {shown.map((t) => {
                const st = statusOf(t);
                return (
                  <article key={t.id} className={`board-card prio-${{ Dringend: 'urgent', Hoch: 'high', Niedrig: 'low' }[t.priority] || 'normal'} ${st === 'Erledigt' ? 'done' : ''} ${dragId === t.id ? 'dragging' : ''}`}
                    draggable onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragId(null); setOver(null); }}
                    onClick={() => onOpen(t)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t)}>
                    <div className="board-card-title">{t.title}</div>
                    {(t.creator_name || t.collaboration_brand) && (
                      <div className="board-card-meta">{[t.creator_name, t.collaboration_brand].filter(Boolean).join(', ')}</div>
                    )}
                    <div className="board-card-foot">
                      <DuePill due={t.due_date} done={st === 'Erledigt'} />
                      {['Dringend', 'Hoch'].includes(t.priority) && st !== 'Erledigt' && <span className={`tl-prio ${t.priority === 'Dringend' ? 'urgent' : 'high'}`}>{t.priority}</span>}
                      <span className="grow" />
                      <AvatarStack ids={t.assignee_ids} />
                    </div>
                    <div className="board-card-move" onClick={(e) => e.stopPropagation()}>
                      <TaskStatusSelect task={{ ...t, status: st }} onChanged={(s2) => setLocal((x) => ({ ...x, [t.id]: s2 }))} />
                    </div>
                  </article>
                );
              })}
              {col.status === 'Erledigt' && list.length > doneLimit && (
                <button className="task-group-reveal" onClick={() => setDoneLimit((n) => n + 30)}>{list.length - doneLimit} weitere anzeigen</button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
