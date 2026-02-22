const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'medicare-secret-key-zmien-mnie-na-produkcji';

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'medicare.db'));
db.pragma('journal_mode = WAL');

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'doctor', 'patient')),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    specialty TEXT,
    phone TEXT,
    pesel TEXT,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES users(id),
    doctor_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
    reason TEXT,
    description TEXT DEFAULT '',
    prescription TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── SEED DEMO DATA ───────────────────────────────────────────────────────────
const seedIfEmpty = () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  console.log('🌱 Seeding demo data...');

  const insert = db.prepare(`
    INSERT INTO users (role, name, email, password, specialty, phone, pesel, avatar)
    VALUES (@role, @name, @email, @password, @specialty, @phone, @pesel, @avatar)
  `);

  const hash = (p) => bcrypt.hashSync(p, 10);

  const users = [
    { role: 'admin',   name: 'Admin',             email: 'admin@klinika.pl',       password: hash('admin123'), specialty: null,          phone: null,          pesel: null,           avatar: 'AD' },
    { role: 'doctor',  name: 'Dr. Jan Kowalski',  email: 'kowalski@klinika.pl',    password: hash('doc123'),   specialty: 'Kardiologia', phone: null,          pesel: null,           avatar: 'JK' },
    { role: 'doctor',  name: 'Dr. Anna Nowak',    email: 'nowak@klinika.pl',       password: hash('doc123'),   specialty: 'Neurologia',  phone: null,          pesel: null,           avatar: 'AN' },
    { role: 'patient', name: 'Marek Wiśniewski',  email: 'pacjent@test.pl',        password: hash('pac123'),   specialty: null,          phone: '600 123 456', pesel: '85010112345',  avatar: 'MW' },
    { role: 'patient', name: 'Zofia Kamińska',    email: 'pacjent2@test.pl',       password: hash('pac123'),   specialty: null,          phone: '601 987 654', pesel: '92030567890',  avatar: 'ZK' },
  ];

  const insertMany = db.transaction((rows) => rows.forEach(r => insert.run(r)));
  insertMany(users);

  // Get inserted IDs
  const marek = db.prepare('SELECT id FROM users WHERE email = ?').get('pacjent@test.pl');
  const zofia = db.prepare('SELECT id FROM users WHERE email = ?').get('pacjent2@test.pl');
  const kowalski = db.prepare('SELECT id FROM users WHERE email = ?').get('kowalski@klinika.pl');
  const nowak = db.prepare('SELECT id FROM users WHERE email = ?').get('nowak@klinika.pl');

  const insertAppt = db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, date, time, status, reason, description, prescription)
    VALUES (@patient_id, @doctor_id, @date, @time, @status, @reason, @description, @prescription)
  `);

  const appts = [
    { patient_id: marek.id, doctor_id: kowalski.id, date: '2025-02-10', time: '10:00', status: 'completed', reason: 'Ból w klatce piersiowej', description: 'Pacjent zgłosił ból w klatce piersiowej. Wykonano EKG - wynik prawidłowy. Zalecono dietę.', prescription: 'Aspiryna 75mg 1x1\nOmeprazol 20mg 1x1 na czczo' },
    { patient_id: marek.id, doctor_id: nowak.id,    date: '2025-01-20', time: '11:30', status: 'completed', reason: 'Bóle głowy',              description: 'Przewlekłe bóle głowy o charakterze napięciowym. Zlecono rezonans magnetyczny.', prescription: 'Ibuprofen 400mg do 3x1 w razie bólu\nVitaminum B Complex 1x1' },
    { patient_id: zofia.id, doctor_id: kowalski.id, date: '2025-03-05', time: '09:00', status: 'confirmed', reason: 'Kontrolna',               description: '', prescription: '' },
    { patient_id: marek.id, doctor_id: kowalski.id, date: '2025-03-10', time: '14:00', status: 'pending',   reason: 'Kontrolna po leczeniu',   description: '', prescription: '' },
    { patient_id: zofia.id, doctor_id: nowak.id,    date: '2025-03-15', time: '16:00', status: 'pending',   reason: 'Pierwsza wizyta',         description: '', prescription: '' },
  ];

  const insertAppts = db.transaction((rows) => rows.forEach(r => insertAppt.run(r)));
  insertAppts(appts);

  console.log('✅ Demo data seeded!');
};

seedIfEmpty();

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Brak tokenu' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Nieprawidłowy token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Brak uprawnień' });
  next();
};

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Podaj email i hasło' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Nieprawidłowy email lub hasło' });

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email, avatar: user.avatar, specialty: user.specialty },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  const { password: _, ...userSafe } = user;
  res.json({ token, user: userSafe });
});

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone, pesel } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Wypełnij wszystkie pola' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email już zajęty' });

  const avatar = name.slice(0, 2).toUpperCase();
  const hashed = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (role, name, email, password, phone, pesel, avatar)
    VALUES ('patient', ?, ?, ?, ?, ?, ?)
  `).run(name, email, hashed, phone || null, pesel || null, avatar);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email, avatar: user.avatar },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  const { password: _, ...userSafe } = user;
  res.status(201).json({ token, user: userSafe });
});

// ─── USERS ROUTES ─────────────────────────────────────────────────────────────

// GET /api/users/doctors
app.get('/api/users/doctors', auth, (req, res) => {
  const doctors = db.prepare("SELECT id, name, email, specialty, avatar FROM users WHERE role = 'doctor'").all();
  res.json(doctors);
});

// GET /api/users/patients  (doctor/admin only)
app.get('/api/users/patients', auth, requireRole('doctor', 'admin'), (req, res) => {
  const patients = db.prepare("SELECT id, name, email, phone, pesel, avatar, created_at FROM users WHERE role = 'patient'").all();
  res.json(patients);
});

// GET /api/users/me
app.get('/api/users/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, role, name, email, specialty, phone, pesel, avatar FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PATCH /api/users/me
app.patch('/api/users/me', auth, (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Imię i email są wymagane' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (exists) return res.status(409).json({ error: 'Email już zajęty' });

  const avatar = name.slice(0, 2).toUpperCase();

  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, avatar = ?, password = ? WHERE id = ?')
      .run(name, email, phone || null, avatar, hashed, req.user.id);
  } else {
    db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, avatar = ? WHERE id = ?')
      .run(name, email, phone || null, avatar, req.user.id);
  }

  const user = db.prepare('SELECT id, role, name, email, specialty, phone, pesel, avatar FROM users WHERE id = ?').get(req.user.id);
  const token = require('jsonwebtoken').sign(
    { id: user.id, role: user.role, name: user.name, email: user.email, avatar: user.avatar, specialty: user.specialty },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ user, token });
});

// DELETE /api/users/me
app.delete('/api/users/me', auth, requireRole('patient'), (req, res) => {
  db.prepare('UPDATE appointments SET status = ? WHERE patient_id = ? AND status IN (?, ?)').run('cancelled', req.user.id, 'pending', 'confirmed');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

// ─── APPOINTMENTS ROUTES ──────────────────────────────────────────────────────

// GET /api/appointments  — filtrowane wg roli
app.get('/api/appointments', auth, (req, res) => {
  let query, params;

  if (req.user.role === 'patient') {
    query = 'SELECT * FROM appointments WHERE patient_id = ? ORDER BY date DESC, time DESC';
    params = [req.user.id];
  } else if (req.user.role === 'doctor') {
    query = 'SELECT * FROM appointments WHERE doctor_id = ? ORDER BY date DESC, time DESC';
    params = [req.user.id];
  } else {
    query = 'SELECT * FROM appointments ORDER BY date DESC, time DESC';
    params = [];
  }

  const rows = db.prepare(query).all(...params);

  // Dołącz dane usera do każdej wizyty
  const enriched = rows.map(a => ({
    ...a,
    patientId: a.patient_id,
    doctorId: a.doctor_id,
    patient: db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(a.patient_id),
    doctor:  db.prepare('SELECT id, name, avatar, specialty FROM users WHERE id = ?').get(a.doctor_id),
  }));

  res.json(enriched);
});

// POST /api/appointments  (patient only)
app.post('/api/appointments', auth, requireRole('patient'), (req, res) => {
  const { doctorId, date, time, reason } = req.body;
  if (!doctorId || !date || !time || !reason)
    return res.status(400).json({ error: 'Wypełnij wszystkie pola' });

  // Sprawdź czy termin wolny
  const taken = db.prepare('SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND time = ? AND status != ?')
    .get(doctorId, date, time, 'cancelled');
  if (taken) return res.status(409).json({ error: 'Ten termin jest już zajęty' });

  const result = db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, date, time, status, reason, description, prescription)
    VALUES (?, ?, ?, ?, 'pending', ?, '', '')
  `).run(req.user.id, doctorId, date, time, reason);

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...appt, patientId: appt.patient_id, doctorId: appt.doctor_id });
});

// PATCH /api/appointments/:id/status  (doctor/admin)
app.patch('/api/appointments/:id/status', auth, requireRole('doctor', 'admin'), (req, res) => {
  const { status } = req.body;
  const validStatuses = ['confirmed', 'cancelled', 'pending'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Nieprawidłowy status' });

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Nie znaleziono wizyty' });
  if (req.user.role === 'doctor' && appt.doctor_id !== req.user.id)
    return res.status(403).json({ error: 'Brak uprawnień' });

  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// PATCH /api/appointments/:id/complete  (doctor only)
app.patch('/api/appointments/:id/complete', auth, requireRole('doctor'), (req, res) => {
  const { description, prescription } = req.body;
  if (!description) return res.status(400).json({ error: 'Opis wizyty jest wymagany' });

  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Nie znaleziono wizyty' });
  if (appt.doctor_id !== req.user.id) return res.status(403).json({ error: 'Brak uprawnień' });

  db.prepare(`
    UPDATE appointments SET status = 'completed', description = ?, prescription = ? WHERE id = ?
  `).run(description, prescription || '', req.params.id);

  res.json({ success: true });
});

// GET /api/appointments/taken?doctorId=X&date=Y  (sprawdź zajęte sloty)
app.get('/api/appointments/taken', auth, (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) return res.status(400).json({ error: 'Podaj doctorId i date' });

  const taken = db.prepare(`
    SELECT time FROM appointments WHERE doctor_id = ? AND date = ? AND status != 'cancelled'
  `).all(doctorId, date).map(r => r.time);

  res.json(taken);
});

// ─── ROOT ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const sections = [
    {
      title: '🔐 Auth',
      rows: [
        { method: 'POST', path: '/api/auth/login',    desc: 'Logowanie',            details: 'body: email, password',                         auth: false },
        { method: 'POST', path: '/api/auth/register', desc: 'Rejestracja pacjenta', details: 'body: name, email, password, phone?, pesel?',   auth: false },
      ]
    },
    {
      title: '👤 Users',
      rows: [
        { method: 'GET',    path: '/api/users/me', desc: 'Zalogowany użytkownik', details: '',                                     auth: true, roles: 'wszyscy' },
        { method: 'PATCH',  path: '/api/users/me', desc: 'Edytuj swój profil',      details: 'body: name, email, phone?, password?',      auth: true, roles: 'wszyscy' },
        { method: 'DELETE', path: '/api/users/me', desc: 'Usuń swoje konto',         details: 'anuluje też pending/confirmed wizyty',      auth: true, roles: 'patient' },
        { method: 'GET', path: '/api/users/doctors',  desc: 'Lista lekarzy',         details: '',                        auth: true, roles: 'wszyscy' },
        { method: 'GET', path: '/api/users/patients', desc: 'Lista pacjentów',       details: '',                        auth: true, roles: 'doctor, admin' },
      ]
    },
    {
      title: '📅 Appointments',
      rows: [
        { method: 'GET',   path: '/api/appointments',                       desc: 'Moje wizyty',    details: 'filtrowane wg roli',                         auth: true, roles: 'wszyscy' },
        { method: 'GET',   path: '/api/appointments/taken?doctorId=&date=', desc: 'Zajęte sloty',   details: 'query: doctorId, date',                      auth: true, roles: 'wszyscy' },
        { method: 'POST',  path: '/api/appointments',                       desc: 'Umów wizytę',    details: 'body: doctorId, date, time, reason',         auth: true, roles: 'patient' },
        { method: 'PATCH', path: '/api/appointments/:id/status',            desc: 'Zmień status',   details: 'body: status → pending/confirmed/cancelled', auth: true, roles: 'doctor, admin' },
        { method: 'PATCH', path: '/api/appointments/:id/complete',          desc: 'Zakończ wizytę', details: 'body: description, prescription?',           auth: true, roles: 'doctor' },
      ]
    },
  ];

  const colors = { GET: ['#1b5e20','#e8f5e9','#a5d6a7'], POST: ['#0d47a1','#e3f2fd','#90caf9'], PATCH: ['#bf360c','#fbe9e7','#ffab91'] };

  const html = sections.map(s => `
    <div class="section">
      <div class="section-title">${s.title}</div>
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Opis</th><th>Szczegóły</th><th>Auth</th></tr></thead>
        <tbody>${s.rows.map(r => {
          const [fg, bg, border] = colors[r.method] || ['#333','#eee','#ccc'];
          return `<tr>
            <td><span class="badge" style="color:${fg};background:${bg};border:1px solid ${border}">${r.method}</span></td>
            <td><code>${r.path}</code></td>
            <td>${r.desc}</td>
            <td class="dim">${r.details || '—'}</td>
            <td>${r.auth ? `<span class="chip lock">🔒 ${r.roles}</span>` : '<span class="chip open">public</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MediCare API</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;color:#111;padding:40px 20px}
    .wrap{max-width:960px;margin:0 auto}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    header h1{font-size:24px;display:flex;align-items:center;gap:10px;color:#1e2d3d}
    .running{background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;letter-spacing:.3px}
    .meta{font-size:12px;color:#888;margin-bottom:28px}
    .meta a{color:#1565c0;text-decoration:none}
    .section{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);margin-bottom:20px}
    .section-title{padding:13px 20px;background:#1e2d3d;color:#fff;font-size:13px;font-weight:600;letter-spacing:.3px}
    table{width:100%;border-collapse:collapse}
    th{padding:9px 16px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;background:#fafafa;border-bottom:1px solid #f0f0f0}
    td{padding:11px 16px;font-size:13px;border-bottom:1px solid #f5f5f5;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#fafafa}
    .badge{display:inline-block;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.5px}
    code{font-family:'SF Mono',Menlo,monospace;font-size:12px;background:#f0f0f0;padding:3px 7px;border-radius:4px;color:#1e2d3d;white-space:nowrap}
    .dim{color:#aaa;font-size:12px;font-family:'SF Mono',Menlo,monospace}
    .chip{font-size:11px;padding:2px 9px;border-radius:10px;font-weight:500;white-space:nowrap;display:inline-block}
    .lock{color:#bf360c;background:#fbe9e7;border:1px solid #ffccbc}
    .open{color:#2e7d32;background:#e8f5e9;border:1px solid #a5d6a7}
    footer{text-align:center;color:#bbb;font-size:12px;margin-top:20px}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1><a href="/" style="text-decoration:none;color:inherit">✚ MediCare API</a></h1>
      <span class="running">● running</span>
    </header>
    <div class="meta">v1.0.0 &nbsp;·&nbsp; ${new Date().toLocaleString('pl-PL')} &nbsp;·&nbsp; Frontend: <a href="http://localhost:5173" target="_blank">localhost:5173</a></div>
    ${html}
    <footer>Endpointy z 🔒 wymagają nagłówka &nbsp;<code>Authorization: Bearer &lt;token&gt;</code></footer>
  </div>
</body>
</html>`);
});


// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏥 MediCare API running at http://localhost:${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/auth/register`);
  console.log(`   GET  /api/users/doctors`);
  console.log(`   GET  /api/users/patients`);
  console.log(`   GET  /api/appointments`);
  console.log(`   POST /api/appointments`);
  console.log(`   PATCH /api/appointments/:id/status`);
  console.log(`   PATCH /api/appointments/:id/complete\n`);
});