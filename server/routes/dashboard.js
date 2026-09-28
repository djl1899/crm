import { q, one, TODAY } from '../db.js';
import { intParam } from '../http.js';
import { ACTIVE_COLLAB_SQL, REVENUE_COLLAB_SQL, OPEN_TASK_SQL } from './creators.js';
import { REVENUE_DATE_SQL } from './collaborations.js';

export default function register(route) {
  route('GET', '/dashboard', async () => {
    const [kpi, recentContacts, followups, deadlines, tasks, activities] = await Promise.all([
      one(`select
        (select count(*)::int from creators) as creators_total,
        (select count(*)::int from creators where created_at > now() - interval '30 days') as creators_new,
        (select count(*)::int from creators where status = 'Aktiv') as creators_active,
        (select count(*)::int from creators where status = 'Pausiert') as creators_paused,
        (select count(*)::int from creators where status = 'Archiviert') as creators_archived,
        (select count(*)::int from creators where contacted = false and status <> 'Archiviert') as creators_not_contacted,

        (select count(*)::int from creators where outreach_status = 'Noch nicht kontaktiert' and status <> 'Archiviert') as outreach_not_contacted,
        (select count(*)::int from creators where contacted = true and status <> 'Archiviert') as outreach_contacted,
        (select count(*)::int from creators where outreach_status in ('Kontaktiert', 'Follow-up erforderlich') and status <> 'Archiviert') as outreach_awaiting,
        (select count(*)::int from outreach_activities where follow_up_done = false and follow_up_date = ${TODAY}) as followups_today,
        (select count(*)::int from outreach_activities where follow_up_done = false and follow_up_date < ${TODAY}) as followups_overdue,
        (select count(*)::int from outreach_activities where follow_up_done = false and follow_up_date > ${TODAY} and follow_up_date <= ${TODAY} + 7) as followups_week,

        (select count(*)::int from collaborations where status in (${ACTIVE_COLLAB_SQL})) as collabs_active,
        (select count(*)::int from collaborations where status = 'Geplant') as collabs_planned,
        (select count(*)::int from collaborations where status in ('Anfrage', 'Verhandlung')) as collabs_pipeline,
        (select count(*)::int from collaborations where status = 'Abgeschlossen') as collabs_completed,

        (select count(*)::int from tasks where status in (${OPEN_TASK_SQL})) as tasks_open,
        (select count(*)::int from tasks where status in (${OPEN_TASK_SQL}) and due_date = ${TODAY}) as tasks_today,
        (select count(*)::int from tasks where status in (${OPEN_TASK_SQL}) and due_date < ${TODAY}) as tasks_overdue,

        (select count(*)::int from contracts ct join creators c on c.id = ct.creator_id where ct.status = 'Aktiv') as contracts_active,
        (select count(*)::int from contracts where status = 'Aktiv' and end_date between ${TODAY} and ${TODAY} + 30) as contracts_expiring,
        (select count(*)::int from creators c left join contracts ct on ct.creator_id = c.id
           where c.status <> 'Archiviert' and coalesce(ct.status, 'Kein Vertrag') = 'Kein Vertrag') as creators_without_contract,

        (select coalesce(sum(fee), 0) from collaborations co where status in (${REVENUE_COLLAB_SQL})) as revenue_total,
        (select coalesce(sum(fee), 0) from collaborations co where status in (${REVENUE_COLLAB_SQL})
           and date_trunc('month', ${REVENUE_DATE_SQL}) = date_trunc('month', ${TODAY})) as revenue_month,
        (select coalesce(sum(fee), 0) from collaborations co where status in (${REVENUE_COLLAB_SQL})
           and date_trunc('year', ${REVENUE_DATE_SQL}) = date_trunc('year', ${TODAY})) as revenue_year`),
      q(`select * from (
           select distinct on (o.creator_id) o.id, o.creator_id, c.display_name as creator_name, o.occurred_at, o.channel, o.result, u.name as user_name
           from outreach_activities o join creators c on c.id = o.creator_id left join users u on u.id = o.user_id
           where o.occurred_at > now() - interval '180 days'
           order by o.creator_id, o.occurred_at desc
         ) x order by occurred_at desc limit 6`),
      q(`select o.id, o.creator_id, c.display_name as creator_name, o.follow_up_date, o.channel, o.subject, o.result,
           u.name as user_name, (o.follow_up_date < ${TODAY}) as overdue, (o.follow_up_date = ${TODAY}) as today
         from outreach_activities o join creators c on c.id = o.creator_id left join users u on u.id = o.user_id
         where o.follow_up_done = false and o.follow_up_date is not null and o.follow_up_date <= ${TODAY} + 7
         order by o.follow_up_date asc, o.id asc limit 12`),
      q(`select co.id, co.creator_id, c.display_name as creator_name, co.brand, co.campaign_name, co.deadline, co.status
         from collaborations co join creators c on c.id = co.creator_id
         where co.deadline >= ${TODAY} and co.status not in ('Abgeschlossen', 'Abgebrochen')
         order by co.deadline asc limit 6`),
      q(`select t.id, t.title, t.due_date, t.priority, t.status, t.creator_id, c.display_name as creator_name,
           a.name as assignee_name, (t.due_date < ${TODAY}) as overdue
         from tasks t left join creators c on c.id = t.creator_id left join users a on a.id = t.assignee_id
         where t.status in (${OPEN_TASK_SQL})
         order by t.due_date asc nulls last, array_position(array['Dringend','Hoch','Normal','Niedrig']::text[], t.priority) limit 8`),
      q(`select a.id, a.message, a.action, a.created_at, a.creator_id, c.display_name as creator_name, u.name as user_name
         from activities a left join creators c on c.id = a.creator_id left join users u on u.id = a.user_id
         order by a.created_at desc, a.id desc limit 15`),
    ]);
    return { kpi, recent_contacts: recentContacts, followups, deadlines, tasks, activities };
  });

  route('GET', '/activities', async ({ query }) => {
    const limit = intParam(query.get('limit'), { min: 1, max: 200, def: 50 });
    const items = await q(
      `select a.id, a.message, a.action, a.created_at, a.creator_id, c.display_name as creator_name, u.name as user_name
       from activities a left join creators c on c.id = a.creator_id left join users u on u.id = a.user_id
       order by a.created_at desc, a.id desc limit $1`,
      [limit]
    );
    return { items };
  });

  // Globale Suche über Creator, Social-Usernames, Brands/Kooperationen und Aufgaben
  route('GET', '/search', async ({ query }) => {
    const s = (query.get('q') || '').trim().replace(/^@/, '');
    if (s.length < 2) return { creators: [], collaborations: [], tasks: [] };
    const like = `%${s.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const [creators, collaborations, tasks] = await Promise.all([
      q(`select c.id, c.display_name, c.status, c.city, c.niche,
           ig.username as instagram_username, tt.username as tiktok_username
         from creators c
         left join social_accounts ig on ig.creator_id = c.id and ig.platform = 'instagram'
         left join social_accounts tt on tt.creator_id = c.id and tt.platform = 'tiktok'
         where c.display_name ilike $1 or c.first_name ilike $1 or c.last_name ilike $1 or c.email ilike $1
           or ig.username ilike $1 or tt.username ilike $1
         order by (c.status = 'Archiviert'), (lower(c.display_name) like lower($2) || '%') desc, c.display_name limit 8`, [like, s]),
      q(`select co.id, co.brand, co.campaign_name, co.status, co.creator_id, c.display_name as creator_name
         from collaborations co join creators c on c.id = co.creator_id
         where co.brand ilike $1 or co.campaign_name ilike $1
         order by co.created_at desc limit 6`, [like]),
      q(`select t.id, t.title, t.status, t.due_date, t.creator_id, c.display_name as creator_name
         from tasks t left join creators c on c.id = t.creator_id
         where t.title ilike $1 order by t.created_at desc limit 6`, [like]),
    ]);
    return { creators, collaborations, tasks };
  });
}
