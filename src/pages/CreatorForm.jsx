import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useForm, invalidateAll } from '../lib/useApi.js';
import { useNavigate } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { PageHeader, Button, Card, Field, Select, Spinner, ErrorBox, Avatar, useUi, handleFormError } from '../components/ui.jsx';
import { UserSelect, TagPicker } from '../components/forms.jsx';
import { Icon } from '../components/Icon.jsx';
import { CREATOR_STATUSES, OUTREACH_STATUSES, PLATFORMS, AVATAR_TYPES } from '../../shared/constants.js';

const EMPTY_SOCIAL = { username: '', url: '', followers: '', engagement_rate: '', notes: '' };

export function CreatorFormPage({ params }) {
  const editId = params.id ? Number(params.id) : null;
  const { data, error, loading } = useApi(editId ? `/creators/${editId}` : null);
  if (editId && loading && !data) return <Spinner />;
  if (editId && error && !data) return <ErrorBox error={error} />;
  return <CreatorForm key={editId || 'new'} editId={editId} profile={data} />;
}

function CreatorForm({ editId, profile }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);

  const c = profile?.creator || {};
  const social = (k) => {
    const s = profile?.socials?.[k];
    return s ? { username: s.username || '', url: s.url || '', followers: s.followers ?? '', engagement_rate: s.engagement_rate ?? '', notes: s.notes || '' } : { ...EMPTY_SOCIAL };
  };
  const f = useForm({
    display_name: c.display_name || '', first_name: c.first_name || '', last_name: c.last_name || '',
    email: c.email || '', phone: c.phone || '', city: c.city || '', region: c.region || '', country: c.country || (editId ? '' : 'Deutschland'),
    language: c.language || '', niche: c.niche || '', interests: c.interests || '', notes: c.notes || '',
    manager_id: editId ? (c.manager_id ? String(c.manager_id) : '') : String(user.id),
    status: c.status || 'Lead', outreach_status: c.outreach_status || 'Noch nicht kontaktiert', contacted: !!c.contacted,
    commission_rate: c.commission_rate ?? '', bio: c.bio || '',
    billing_name: c.billing_name || '', billing_street: c.billing_street || '', billing_zip: c.billing_zip || '', billing_city: c.billing_city || '',
    iban: c.iban || '', bank_holder: c.bank_holder || '', tax_number: c.tax_number || '', vat_id: c.vat_id || '',
    small_business: c.small_business === true ? 'true' : c.small_business === false ? 'false' : '',
    tag_ids: (profile?.tags || []).map((t) => t.id),
    instagram: social('instagram'), tiktok: social('tiktok'),
  });
  const v = f.values;
  const options = useApi('/creators/filter-options');

  useEffect(() => () => avatarPreview && URL.revokeObjectURL(avatarPreview), [avatarPreview]);

  const setSocial = (platform, key) => (e) => {
    const val = e.target.value;
    f.setValues((x) => ({ ...x, [platform]: { ...x[platform], [key]: val } }));
    f.setErrors((errs) => ({ ...errs, [platform]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!v.display_name.trim()) return f.setErrors({ display_name: 'Creator Name ist ein Pflichtfeld.' });
    setSaving(true);
    try {
      let id = editId;
      const payload = { ...v };
      if (payload.small_business === '') delete payload.small_business;
      if (editId) {
        await api.patch(`/creators/${editId}`, payload);
      } else {
        const res = await api.post('/creators', payload);
        id = res.creator.id;
      }
      if (avatarFile) {
        const fd = new FormData();
        fd.append('file', avatarFile);
        try {
          await api.upload(`/creators/${id}/avatar`, fd);
        } catch (err) {
          toast(`Creator gespeichert, aber Profilbild fehlgeschlagen: ${err.message}`, 'error');
        }
      }
      invalidateAll();
      toast(editId ? 'Änderungen gespeichert.' : 'Creator angelegt.');
      navigate(`/creators/${id}`, { replace: !editId });
    } catch (err) {
      // Fehler aus verschachtelten Social-Feldern werden dem Social-Block zugeordnet
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return toast('Bitte ein Bild (JPG, PNG, WebP, GIF) wählen.', 'error');
    if (file.size > 3 * 1024 * 1024) return toast('Das Bild ist zu groß (max. 3 MB).', 'error');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  return (
    <form className="page" onSubmit={submit} noValidate>
      <PageHeader
        title={editId ? `${c.display_name} bearbeiten` : 'Creator hinzufügen'}
        back={editId ? { to: `/creators/${editId}`, label: 'Zurück zum Profil' } : { to: '/creators', label: 'Creator' }}
        actions={
          <>
            <Button onClick={() => navigate(editId ? `/creators/${editId}` : '/creators')}>Abbrechen</Button>
            <Button variant="primary" type="submit" loading={saving} icon="check">Speichern</Button>
          </>
        }
      />

      <div className="form-layout">
        <div className="form-col">
          <Card title="Grunddaten">
            <div className="avatar-edit">
              <Avatar name={v.display_name || '?'} url={avatarPreview || c.avatar_url} size={64} />
              <label className="btn btn-secondary btn-sm">
                <Icon name="camera" size={15} /> <span>{avatarPreview || c.avatar_url ? 'Bild ändern' : 'Profilbild hochladen'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={pickAvatar} />
              </label>
            </div>
            <div className="form-grid">
              <Field label="Creator Name" required error={f.errors.display_name} className="span-2">
                <input className="input" value={v.display_name} onChange={f.set('display_name')} autoFocus={!editId} placeholder="z. B. Anna Müller" />
              </Field>
              <Field label="Vorname" error={f.errors.first_name}>
                <input className="input" value={v.first_name} onChange={f.set('first_name')} />
              </Field>
              <Field label="Nachname" error={f.errors.last_name}>
                <input className="input" value={v.last_name} onChange={f.set('last_name')} />
              </Field>
              <Field label="Nische" error={f.errors.niche}>
                <input className="input" list="niche-options" value={v.niche} onChange={f.set('niche')} placeholder="z. B. Fashion / Lifestyle" />
                <datalist id="niche-options">{(options.data?.niches || []).map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
              <Field label="Sprache" error={f.errors.language}>
                <input className="input" value={v.language} onChange={f.set('language')} placeholder="z. B. Deutsch, Englisch" />
              </Field>
              <Field label="Kurzvorstellung (öffentlich, erscheint im Mediakit)" error={f.errors.bio} className="span-2">
                <textarea className="input" rows={3} value={v.bio} onChange={f.set('bio')} placeholder="z. B. Anna teilt mit ihrer Community in Berlin nachhaltige Mode, ehrliche Reviews und Alltags-Looks." />
              </Field>
              <Field label="Interessen" error={f.errors.interests} className="span-2">
                <input className="input" value={v.interests} onChange={f.set('interests')} placeholder="z. B. Reisen, Mode, Kaffee" />
              </Field>
            </div>
          </Card>

          <Card title="Kontakt & Standort">
            <div className="form-grid">
              <Field label="E-Mail" error={f.errors.email}>
                <input className="input" type="email" value={v.email} onChange={f.set('email')} />
              </Field>
              <Field label="Telefonnummer" error={f.errors.phone}>
                <input className="input" type="tel" value={v.phone} onChange={f.set('phone')} />
              </Field>
              <Field label="Ort" error={f.errors.city}>
                <input className="input" value={v.city} onChange={f.set('city')} />
              </Field>
              <Field label="Region" error={f.errors.region}>
                <input className="input" list="region-options" value={v.region} onChange={f.set('region')} placeholder="z. B. Berlin, Bayern" />
                <datalist id="region-options">{(options.data?.regions || []).map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
              <Field label="Land" error={f.errors.country}>
                <input className="input" list="country-options" value={v.country} onChange={f.set('country')} />
                <datalist id="country-options">{['Deutschland', 'Österreich', 'Schweiz', ...(options.data?.countries || [])].filter((x, i, a) => a.indexOf(x) === i).map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
            </div>
          </Card>

          <Card title="Rechnungs- & Bankdaten" subtitle="Kann der Creator auch selbst im Creator-Bereich pflegen">
            <div className="form-grid">
              <Field label="Rechnungsname" hint="Name oder Firma, wie auf Rechnungen" error={f.errors.billing_name} className="span-2">
                <input className="input" value={v.billing_name} onChange={f.set('billing_name')} />
              </Field>
              <Field label="Straße und Hausnummer" error={f.errors.billing_street} className="span-2">
                <input className="input" value={v.billing_street} onChange={f.set('billing_street')} />
              </Field>
              <Field label="PLZ" error={f.errors.billing_zip}>
                <input className="input" value={v.billing_zip} onChange={f.set('billing_zip')} />
              </Field>
              <Field label="Ort" error={f.errors.billing_city}>
                <input className="input" value={v.billing_city} onChange={f.set('billing_city')} />
              </Field>
              <Field label="IBAN" error={f.errors.iban}>
                <input className="input mono" value={v.iban} onChange={f.set('iban')} placeholder="DE00 0000 0000 0000 0000 00" />
              </Field>
              <Field label="Kontoinhaber" error={f.errors.bank_holder}>
                <input className="input" value={v.bank_holder} onChange={f.set('bank_holder')} />
              </Field>
              <Field label="Steuernummer" error={f.errors.tax_number}>
                <input className="input" value={v.tax_number} onChange={f.set('tax_number')} />
              </Field>
              <Field label="USt-IdNr." error={f.errors.vat_id}>
                <input className="input" value={v.vat_id} onChange={f.set('vat_id')} placeholder="DE…" />
              </Field>
              <Field label="Kleinunternehmer (§ 19 UStG)" error={f.errors.small_business}>
                <Select value={v.small_business} onChange={f.set('small_business')} placeholder="– unbekannt –" options={[{ value: 'true', label: 'Ja' }, { value: 'false', label: 'Nein' }]} />
              </Field>
            </div>
          </Card>
          <Card title="Social Media">
            {PLATFORMS.map((p) => (
              <fieldset key={p.key} className="social-fieldset">
                <legend><Icon name={p.key} size={16} /> {p.label}</legend>
                {f.errors[p.key] && <div className="field-error">{f.errors[p.key]}</div>}
                <div className="form-grid">
                  <Field label="Username">
                    <div className="input-prefix"><span>@</span>
                      <input className="input" value={v[p.key].username} onChange={setSocial(p.key, 'username')} placeholder="username" />
                    </div>
                  </Field>
                  <Field label="Profil-URL" hint="Wird automatisch aus dem Username erzeugt, wenn leer.">
                    <input className="input" type="url" value={v[p.key].url} onChange={setSocial(p.key, 'url')} placeholder={p.profileUrl('username')} />
                  </Field>
                  <Field label="Follower">
                    <input className="input" type="number" min="0" step="1" value={v[p.key].followers} onChange={setSocial(p.key, 'followers')} />
                  </Field>
                  <Field label="Engagement Rate (%)">
                    <input className="input" type="number" min="0" max="100" step="0.01" value={v[p.key].engagement_rate} onChange={setSocial(p.key, 'engagement_rate')} />
                  </Field>
                  <Field label="Notizen" className="span-2">
                    <input className="input" value={v[p.key].notes} onChange={setSocial(p.key, 'notes')} />
                  </Field>
                </div>
              </fieldset>
            ))}
          </Card>
        </div>

        <div className="form-col form-col-side">
          <Card title="Status & Organisation">
            <div className="stack">
              <Field label="Creator Status" error={f.errors.status}>
                <Select value={v.status} onChange={f.set('status')} options={CREATOR_STATUSES} />
              </Field>
              <Field label="Outreach Status" error={f.errors.outreach_status}>
                <Select value={v.outreach_status} onChange={f.set('outreach_status')} options={OUTREACH_STATUSES} />
              </Field>
              <Field label="Creator bereits angeschrieben?">
                <div className="yesno">
                  <button type="button" className={!v.contacted ? 'active' : ''} onClick={() => f.setValues((x) => ({ ...x, contacted: false }))}>Nein</button>
                  <button type="button" className={v.contacted ? 'active' : ''} onClick={() => f.setValues((x) => ({ ...x, contacted: true }))}>Ja</button>
                </div>
              </Field>
              <Field label="Verantwortlicher Manager" error={f.errors.manager_id}>
                <UserSelect value={v.manager_id} onChange={f.set('manager_id')} />
              </Field>
              <Field label="Agenturprovision (%)" error={f.errors.commission_rate} hint="Leer = Standard aus den Einstellungen. Einzelne Kooperationen können abweichen.">
                <input className="input" type="number" min="0" max="100" step="0.5" value={v.commission_rate} onChange={f.set('commission_rate')} placeholder="Standard" />
              </Field>
              <Field label="Tags">
                <TagPicker value={v.tag_ids} onChange={(ids) => f.setValues((x) => ({ ...x, tag_ids: ids }))} />
              </Field>
            </div>
          </Card>
          <Card title="Interne Notizen">
            <textarea className="input" rows={8} value={v.notes} onChange={f.set('notes')} placeholder="Nur intern sichtbar" />
          </Card>
        </div>
      </div>
      <div className="form-footer-mobile">
        <Button variant="primary" type="submit" loading={saving} className="btn-block">Speichern</Button>
      </div>
    </form>
  );
}
