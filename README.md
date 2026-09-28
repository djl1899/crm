# Creator CRM – Influencer-Management

Internes CRM für Influencer-/Creator-Management. Der **Creator ist die zentrale Einheit**: Social Media, Outreach & Kontaktverlauf, Follow-ups, Kooperationen, Aufgaben, Verträge, Dokumente, Finanzen, Tags und Aktivitäten hängen alle am Creator-Profil.

- **Frontend:** React 19 (Single-Page-App, eigenes CSS, keine UI-Frameworks)
- **Backend:** eine Netlify Function (`/api/*`) mit REST-API
- **Datenbank:** PostgreSQL (relational, mit Fremdschlüsseln & Indizes; Schema wird beim ersten Aufruf automatisch angelegt)
- **Dateien:** Netlify Blobs (dauerhafter Speicher, automatisch in jeder Netlify-Site verfügbar)
- **Login:** Sitzungs-Cookie (HttpOnly, signiert), Passwörter mit scrypt gehasht

---

## Auf Netlify veröffentlichen (ca. 10 Minuten)

> Hinweis: Das Ziehen des Ordners in „Netlify Drop“ reicht **nicht**, weil die App einen Build-Schritt und eine Server-Funktion braucht. Der Weg über GitHub ist der einfachste.

### 1. Datenbank anlegen (kostenlos, z. B. bei Neon)
1. Auf **https://neon.tech** ein kostenloses Konto erstellen.
2. Ein neues Projekt anlegen (Region: z. B. *Frankfurt / eu-central-1*).
3. Im Dashboard auf **Connect** klicken und den **Connection String** kopieren. Er sieht so aus:
   `postgresql://benutzer:passwort@ep-xyz.eu-central-1.aws.neon.tech/neondb?sslmode=require`

(Jeder andere PostgreSQL-Anbieter funktioniert ebenfalls, z. B. Supabase.)

### 2. Code auf GitHub hochladen
1. Auf **https://github.com/new** ein neues, **privates** Repository anlegen (z. B. `creator-crm`).
2. Auf der Repo-Seite „uploading an existing file“ wählen und **den Inhalt** dieses Ordners hineinziehen (nicht den Ordner selbst – `package.json` muss auf der obersten Ebene liegen).
3. „Commit changes“ klicken.

### 3. Netlify-Site erstellen
1. Auf **https://app.netlify.com** → **Add new site → Import an existing project → GitHub** → das Repository auswählen.
2. Die Build-Einstellungen werden automatisch aus `netlify.toml` gelesen (Build command `npm run build`, Publish directory `dist`). Nichts ändern.
3. **Vor dem ersten Deploy** (oder danach unter *Site configuration → Environment variables*) eine Variable anlegen:
   - Key: `DATABASE_URL`
   - Value: der kopierte Connection String von Neon
4. **Deploy** klicken. Falls die Variable erst danach gesetzt wurde: *Deploys → Trigger deploy → Deploy site*.

### 4. Loslegen
1. Die Netlify-URL öffnen (z. B. `https://dein-name.netlify.app`).
2. Es erscheint die **Ersteinrichtung**: Name, E-Mail und Passwort eingeben → dieses Konto wird **Administrator**.
3. Optional das Häkchen „Demo-Daten laden“ gesetzt lassen → 13 fiktive Creator mit Kooperationen, Aufgaben, Outreach und Verträgen zum Ausprobieren.
4. Unter **Benutzer** die Konten für Joshua, Anton usw. anlegen und ihnen das Passwort mitteilen.

Demo-Daten wieder loswerden: In Neon unter *Branches* einfach die Datenbank zurücksetzen bzw. ein neues Projekt anlegen und `DATABASE_URL` austauschen.

### Optionale Einstellungen
| Variable | Zweck |
|---|---|
| `DATABASE_URL` | **Pflicht.** PostgreSQL-Verbindung |
| `SESSION_SECRET` | Optional, mind. 32 zufällige Zeichen. Ohne wird automatisch ein sicheres Secret erzeugt und in der Datenbank gespeichert. |

---

## Funktionen im Überblick

| Bereich | Was geht |
|---|---|
| **Dashboard** | Kennzahlen zu Creatorn, Outreach, Kooperationen, Aufgaben, Verträgen, Finanzen; fällige/überfällige Follow-ups (anklickbar → Outreach-Tab des Creators), anstehende Aufgaben & Deadlines, zuletzt kontaktierte Creator, Aktivitäten-Historie |
| **Creator** | Tabelle (Desktop) bzw. Karten (Mobile), serverseitige Suche (Name, Instagram/TikTok-Username, E-Mail, Ort, Region, Land, Nische), kombinierbare Filter (Status, Plattform, Follower min/max je Plattform, Land, Region, Nische, Manager, angeschrieben ja/nein, aktive Kooperation, Vertrag vorhanden, Vertragsstatus, Tags, Outreach-Status, Archiv), Sortierung, Pagination. Filter stehen in der URL → teilbar & bleiben beim Zurückgehen erhalten |
| **Creator-Profil** | Kopfbereich mit Status, Outreach-Status, „Bereits angeschrieben? Ja/Nein“, Manager, letztem Kontakt und nächstem Follow-up (alles direkt änderbar); Kennzahlen; Tabs: Übersicht, Kontaktdaten, Social Media, Outreach, Kooperationen (aktuell/zukünftig/vergangen), Aufgaben, Vertrag & Dokumente, Finanzen, Aktivitäten, Notizen |
| **Outreach** | Jeder Kontakt als eigener Eintrag (Datum/Uhrzeit, Kanal, Benutzer, Betreff, Nachricht, Ergebnis, Follow-up). Beim Erfassen wird der Creator automatisch als „angeschrieben“ markiert und offene Follow-ups werden geschlossen |
| **Kooperationen** | Beliebig viele pro Creator, alle Felder inkl. Deliverables, Deadline, Vergütung, Rechnungsstatus |
| **Aufgaben** | Mit Creator und optional Kooperation verknüpft; Ansichten Offen/Heute/Diese Woche/Überfällig/Meine/Alle; Filter nach Verantwortlichem, Status, Priorität, Creator |
| **Verträge & Dokumente** | Vertragsdaten pro Creator, Upload von PDF, Bildern, Office-Dateien, TXT/CSV, ZIP (max. 4 MB), Öffnen & Herunterladen |
| **Finanzen** | Gesamtumsatz, Monat, Jahr, bezahlt/offen/überfällig, Umsatz pro Creator, Rechnungsstatus direkt änderbar |
| **Benutzer** | Admins legen Benutzer an, ändern Rollen, deaktivieren Konten, setzen Passwörter zurück. Alle Benutzer sehen und bearbeiten alle Creator |
| **Einstellungen** | Eigenes Profil, Passwort ändern, Tags verwalten (anlegen, umbenennen, Farbe, löschen) |
| **Globale Suche** | Oben in der Leiste (Taste `/` oder Strg+K): Creator, @Usernames, Brands/Kooperationen, Aufgaben |

**Umsatzberechnung:** Gesamtumsatz = Summe der Vergütungen aller Kooperationen mit Status *Geplant, Aktiv, Content ausstehend, Abnahme* oder *Abgeschlossen*. *Anfrage/Verhandlung* (noch nicht bestätigt) und *Abgebrochen* zählen nicht. Monats-/Jahreszuordnung über das Startdatum (ersatzweise Deadline bzw. Enddatum).

**Archivieren vs. Löschen:** Archivieren (Status „Archiviert“) blendet den Creator aus der aktiven Liste aus; er bleibt über den Filter *Archiv* auffindbar und kann wiederhergestellt werden. Endgültiges Löschen (nur Admins) entfernt den Creator samt Kooperationen, Aufgaben, Kontakten, Vertrag und Dateien – mit deutlicher Bestätigung.

---

## Sicherheit
- Passwörter mit **scrypt** + Salt gehasht, nie im Klartext
- Sitzung als **HttpOnly-, Secure-, SameSite-Cookie** mit HMAC-Signatur; Passwortänderung oder Deaktivierung macht bestehende Sitzungen ungültig
- **CSRF-Schutz** (Pflicht-Header bei allen schreibenden Anfragen)
- **Brute-Force-Schutz**: nach 8 Fehlversuchen 15 Minuten Sperre pro E-Mail
- Alle API-Routen außer Login/Setup erfordern Anmeldung; Benutzerverwaltung, Demo-Daten und endgültiges Löschen nur für Admins
- **Serverseitige Validierung** aller Eingaben (E-Mail, URL, Zahlen ≥ 0, Datumsbereiche, Pflichtfelder, Auswahllisten)
- **Sichere Uploads**: Whitelist der Dateiendungen, Prüfung der Datei-Signatur („Magic Bytes“), Größenlimit, bereinigte Dateinamen, Auslieferung mit `nosniff` und isolierender CSP
- Parametrisierte SQL-Abfragen (kein SQL-Injection-Risiko), Sicherheits-Header (CSP, HSTS, X-Frame-Options), `noindex`

---

## Projektstruktur
```
netlify.toml                Build-, Redirect- und Header-Konfiguration
netlify/functions/api.mjs   Einstiegspunkt der API-Funktion
server/                     Backend
  router.js                 Routing + Auth-Prüfung
  schema.js                 Datenbankschema (versionierte Migrationen)
  auth.js                   Passwort-Hashing, Sitzungen, CSRF, Login-Sperre
  validate.js / upload.js   Validierung, sichere Datei-Uploads
  routes/*.js               Endpunkte je Bereich
shared/constants.js         Status-Listen, Plattformen, Kategorien (Frontend + Backend)
src/                        Frontend (React)
scripts/build.mjs           Frontend-Build (esbuild)
scripts/local-server.mjs    Lokaler Server ohne Netlify
scripts/api-test.mjs        End-to-End-Test der API (73 Prüfungen)
```

### Datenbank (Tabellen)
`users`, `creators`, `social_accounts` (eine Zeile je Plattform → weitere Plattformen ohne Schemaänderung), `outreach_activities`, `collaborations`, `tasks`, `contracts`, `documents`, `tags`, `creator_tags`, `activities`, `login_attempts`, `app_meta`. Alle Verknüpfungen über IDs mit Fremdschlüsseln.

### Erweitern
- **Neue Plattform** (z. B. YouTube): in `shared/constants.js` bei `PLATFORMS` eintragen und ein Icon in `src/components/Icon.jsx` ergänzen.
- **Neue Status/Kategorien:** ebenfalls in `shared/constants.js`.
- **Schemaänderungen:** in `server/schema.js` eine neue Migration an das Array `MIGRATIONS` anhängen – sie wird beim nächsten Aufruf automatisch ausgeführt.
- **Weitere Rollen:** `ROLES` in `shared/constants.js` + Prüfungen in `server/auth.js` (`requireAdmin`).

---

## Lokal entwickeln (optional)
Voraussetzung: Node.js 20+ und eine PostgreSQL-Datenbank.
```bash
npm install
npm run build
DATABASE_URL="postgresql://…" npm run local     # → http://localhost:8888
# in einem zweiten Terminal (nur gegen eine leere Datenbank):
npm run test:api
```
Lokal werden hochgeladene Dateien in `.local-files/` gespeichert statt in Netlify Blobs.
