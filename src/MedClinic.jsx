import { useState, useEffect, useCallback } from "react";
import './MedClinic.css';

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const API = 'http://localhost:3001/api';

const apiFetch = async (path, options = {}, token = null) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Błąd serwera');
  return data;
};

const AVAILABLE_SLOTS = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","12:00","13:00","14:00","14:30","15:00","15:30","16:00","16:30"];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
};
const dayNum  = (d) => new Date(d).getDate();
const monthShort = (d) => new Date(d).toLocaleDateString("pl-PL", { month: "short" });

const statusBadge = (s) => {
  const map = {
    pending:   ["Oczekująca",   "badge-pending"],
    confirmed: ["Potwierdzona", "badge-confirmed"],
    completed: ["Zakończona",   "badge-completed"],
    cancelled: ["Anulowana",    "badge-cancelled"],
  };
  const [label, cls] = map[s] || ["Nieznany", ""];
  return <span className={`badge ${cls}`}>{label}</span>;
};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken]               = useState(() => localStorage.getItem('mc_token'));
  const [currentUser, setCurrentUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('mc_user')); } catch { return null; }
  });
  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors]           = useState([]);
  const [patients, setPatients]         = useState([]);
  const [page, setPage]                 = useState("dashboard");
  const [modal, setModal]               = useState(null);
  const [loading, setLoading]           = useState(false);

  const fetchAppointments = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch('/appointments', {}, token);
      setAppointments(data);
    } catch (e) { console.error(e); }
  }, [token]);

  const fetchDoctors = useCallback(async () => {
    if (!token) return;
    try { setDoctors(await apiFetch('/users/doctors', {}, token)); }
    catch (e) { console.error(e); }
  }, [token]);

  const fetchPatients = useCallback(async () => {
    if (!token || currentUser?.role === 'patient') return;
    try { setPatients(await apiFetch('/users/patients', {}, token)); }
    catch (e) { console.error(e); }
  }, [token, currentUser]);

  useEffect(() => {
    if (token && currentUser) {
      fetchAppointments();
      fetchDoctors();
      fetchPatients();
    }
  }, [token, currentUser, fetchAppointments, fetchDoctors, fetchPatients]);

  const handleLogin = (tok, user) => {
    localStorage.setItem('mc_token', tok);
    localStorage.setItem('mc_user', JSON.stringify(user));
    setToken(tok);
    setCurrentUser(user);
    setPage("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    setToken(null);
    setCurrentUser(null);
    setAppointments([]);
    setPage("dashboard");
  };

  const updateAppointmentStatus = async (id, status) => {
    try {
      await apiFetch(`/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
      await fetchAppointments();
    } catch (e) { alert(e.message); }
  };

  const completeAppointment = async (id, description, prescription) => {
    try {
      await apiFetch(`/appointments/${id}/complete`, { method: 'PATCH', body: JSON.stringify({ description, prescription }) }, token);
      await fetchAppointments();
    } catch (e) { alert(e.message); }
  };

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const myAppointments = currentUser.role === 'patient'
    ? appointments.filter(a => a.patient_id === currentUser.id || a.patientId === currentUser.id)
    : currentUser.role === 'doctor'
    ? appointments.filter(a => a.doctor_id === currentUser.id || a.doctorId === currentUser.id)
    : appointments;

  const navItems = currentUser.role === "patient"
    ? [["dashboard", "Pulpit"], ["book", "Umów wizytę"], ["history", "Historia wizyt"], ["settings", "Profil"]]
    : currentUser.role === "doctor"
    ? [["dashboard", "Pulpit"], ["schedule", "Terminarz"], ["patients", "Pacjenci"], ["settings", "Profil"]]
    : [["dashboard", "Pulpit"], ["appointments", "Wszystkie wizyty"], ["patients", "Pacjenci"], ["settings", "Profil"]];

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand" onClick={() => setPage("dashboard")} style={{ cursor: "pointer" }}>
          <div className="logo">✚</div>
          <span className="brand-name">MediCare</span>
        </div>
        <div className="navbar-nav">
          {navItems.map(([key, label]) => (
            <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="navbar-user">
          <div className="user-avatar">{currentUser.avatar || currentUser.name?.slice(0,2).toUpperCase()}</div>
          <div>
            <div className="user-name">{currentUser.name}</div>
            <div className="user-role">{currentUser.role === "patient" ? "Pacjent" : currentUser.role === "doctor" ? "Lekarz" : "Admin"}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>⎋ Wyloguj</button>
        </div>
      </nav>

      <div style={{ flex: 1 }}>
        <div className="main-content">
          {page === "dashboard" && (
            <Dashboard
              user={currentUser}
              appointments={myAppointments}
              doctors={doctors}
              patients={patients}
              setPage={setPage}
              openModal={setModal}
              onStatusChange={updateAppointmentStatus}
            />
          )}
          {page === "book" && currentUser.role === "patient" && (
            <BookAppointment
              doctors={doctors}
              token={token}
              patientId={currentUser.id}
              onBook={async () => { await fetchAppointments(); setPage("dashboard"); }}
            />
          )}
          {page === "history" && currentUser.role === "patient" && (
            <VisitHistory appointments={myAppointments} />
          )}
          {page === "schedule" && currentUser.role === "doctor" && (
            <DoctorSchedule
              appointments={myAppointments}
              onStatusChange={updateAppointmentStatus}
              openModal={setModal}
            />
          )}
          {page === "patients" && (
            <PatientsList patients={patients} appointments={appointments} openModal={setModal} />
          )}
          {page === "appointments" && currentUser.role === "admin" && (
            <AllAppointments appointments={appointments} onStatusChange={updateAppointmentStatus} />
          )}
          {page === "settings" && (
            <ProfileSettings
              user={currentUser}
              token={token}
              onUpdate={(newToken, newUser) => {
                localStorage.setItem('mc_token', newToken);
                localStorage.setItem('mc_user', JSON.stringify(newUser));
                setToken(newToken);
                setCurrentUser(newUser);
              }}
              onDelete={handleLogout}
            />
          )}
        </div>
      </div>

      {modal && (
        <Modal
          modal={modal}
          onClose={() => setModal(null)}
          onComplete={async (id, desc, rx) => {
            await completeAppointment(id, desc, rx);
            setModal(null);
          }}
          onStatusChange={async (id, status) => {
            await updateAppointmentStatus(id, status);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [name, setName]             = useState("");
  const [phone, setPhone]           = useState("");
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);

  const DEMOS = [
    { label: "Pacjent", email: "pacjent@test.pl",     pass: "pac123"   },
    { label: "Lekarz",  email: "kowalski@klinika.pl", pass: "doc123"   },
    { label: "Admin",   email: "admin@klinika.pl",    pass: "admin123" },
  ];

  const fill = (e, p) => { setEmail(e); setPassword(p); setError(""); };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister ? { name, email, password, phone } : { email, password };
      const { token, user } = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      onLogin(token, user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-brand">
          <span className="cross" onClick={() => { setIsRegister(false); setError(""); setEmail(""); setPassword(""); setName(""); setPhone(""); }} style={{cursor:"pointer"}} title="Wróć do logowania">✚</span>
          <h1>Twoje zdrowie w dobrych rękach</h1>

          <img src="/login-illustration.png" alt="" className="login-illustration"/>

          <p>Umawiaj wizyty online, śledź historię leczenia i odbieraj recepty — wszystko w jednym miejscu. Nasi specjaliści są do Twojej dyspozycji, a rejestracja zajmuje mniej niż minutę.</p>
        </div>
        <div className="login-tagline">
          <div className="stat"><div className="stat-num">12</div><div className="stat-label">Lekarzy</div></div>
          <div className="stat"><div className="stat-num">5</div><div className="stat-label">Specjalności</div></div>
          <div className="stat"><div className="stat-num">24/7</div><div className="stat-label">Dostępność</div></div>
        </div>
      </div>
      <div className="login-right">
        <div className="login-form-wrap">
          <h2>{isRegister ? "Rejestracja" : "Zaloguj się"}</h2>
          <p className="subtitle">{isRegister ? "Utwórz konto pacjenta" : "Witaj z powrotem w MediCare"}</p>

          {!isRegister && (
            <div className="demo-accounts">
              <div className="da-title">Konta demo</div>
              {DEMOS.map(d => (
                <div key={d.label} className="demo-row">
                  <strong>{d.label}</strong>
                  <span>{d.email}</span>
                  <button className="demo-btn" onClick={() => fill(d.email, d.pass)}>Użyj</button>
                </div>
              ))}
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          <form onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <div className="form-group">
                  <label>Imię i nazwisko</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Jan Kowalski" />
                </div>
                <div className="form-group">
                  <label>Telefon <span style={{fontWeight:400, textTransform:'none', letterSpacing:0}}>(opcjonalnie)</span></label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="600 123 456" />
                </div>
              </>
            )}
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="twoj@email.pl" />
            </div>
            <div className="form-group">
              <label>Hasło</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? "Ładowanie..." : isRegister ? "Utwórz konto" : "Zaloguj się"}
            </button>
          </form>

          <div className="toggle-form">
            {isRegister ? "Masz już konto?" : "Nie masz konta?"}{" "}
            <button onClick={() => { setIsRegister(!isRegister); setError(""); }}>
              {isRegister ? "Zaloguj się" : "Zarejestruj się"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ user, appointments, doctors, patients, setPage, openModal, onStatusChange }) {
  const upcoming  = appointments.filter(a => a.status !== "completed" && a.status !== "cancelled");
  const completed = appointments.filter(a => a.status === "completed");
  const pending   = appointments.filter(a => a.status === "pending");
  const today     = new Date().toISOString().split("T")[0];
  const todayAppts = appointments.filter(a => a.date === today);

  return (
    <>
      <div className="page-header">
        <h2>Dzień dobry, {user.name?.split(" ")[0]} 👋</h2>
        <p>{new Date().toLocaleDateString("pl-PL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      <div className="stats-grid">
        {user.role === "patient" ? (
          <>
            <div className="stat-card sage"><div className="s-label">Nadchodzące wizyty</div><div className="s-value">{upcoming.length}</div></div>
            <div className="stat-card rust"><div className="s-label">Oczekujące</div><div className="s-value">{pending.length}</div></div>
            <div className="stat-card navy"><div className="s-label">Historia</div><div className="s-value">{completed.length}</div><div className="s-sub">zakończonych wizyt</div></div>
          </>
        ) : user.role === "doctor" ? (
          <>
            <div className="stat-card sage"><div className="s-label">Dziś</div><div className="s-value">{todayAppts.length}</div><div className="s-sub">wizyt dzisiaj</div></div>
            <div className="stat-card rust"><div className="s-label">Do akceptacji</div><div className="s-value">{pending.length}</div></div>
            <div className="stat-card navy"><div className="s-label">Łącznie wizyt</div><div className="s-value">{appointments.length}</div></div>
          </>
        ) : (
          <>
            <div className="stat-card sage"><div className="s-label">Wszyscy lekarze</div><div className="s-value">{doctors.length}</div></div>
            <div className="stat-card rust"><div className="s-label">Wszyscy pacjenci</div><div className="s-value">{patients.length}</div></div>
            <div className="stat-card navy"><div className="s-label">Wizyty łącznie</div><div className="s-value">{appointments.length}</div></div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{user.role === "doctor" ? "Najbliższe wizyty" : "Twoje wizyty"}</h3>
          <button className="btn btn-outline btn-sm" onClick={() => setPage(user.role === "patient" ? "history" : "schedule")}>
            Wszystkie →
          </button>
        </div>
        <div className="card-body">
          {upcoming.length === 0 && <p style={{ color: "var(--text-soft)", textAlign: "center", padding: "20px" }}>Brak nadchodzących wizyt</p>}
          <div className="appt-list">
            {upcoming.slice(0, 5).map(a => {
              const other = user.role === "patient" ? a.doctor : a.patient;
              return (
                <div key={a.id} className="appt-item">
                  <div className="appt-date-box">
                    <div className="day">{dayNum(a.date)}</div>
                    <div className="month">{monthShort(a.date)}</div>
                  </div>
                  <div className="appt-info">
                    <div className="appt-title">{other?.name}</div>
                    <div className="appt-sub">{a.reason}</div>
                  </div>
                  <div className="appt-time">{a.time}</div>
                  {statusBadge(a.status)}
                  {user.role === "doctor" && a.status === "pending" && (
                    <div className="appt-actions">
                      <button className="btn btn-sage btn-sm" onClick={() => onStatusChange(a.id, "confirmed")}>Potwierdź</button>
                    </div>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal({ type: "detail", data: a })}>Szczegóły</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {user.role === "patient" && (
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <button className="btn btn-sage" onClick={() => setPage("book")}>✚ Umów nową wizytę</button>
        </div>
      )}
    </>
  );
}

// ─── BOOK APPOINTMENT ─────────────────────────────────────────────────────────
function BookAppointment({ doctors, token, patientId, onBook }) {
  const [step, setStep]                   = useState(1);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [selectedDate, setSelectedDate]   = useState("");
  const [selectedTime, setSelectedTime]   = useState("");
  const [reason, setReason]               = useState("");
  const [takenSlots, setTakenSlots]       = useState([]);
  const [loading, setLoading]             = useState(false);
  const [success, setSuccess]             = useState(false);
  const [error, setError]                 = useState("");

  useEffect(() => {
    if (!selectedDoctor || !selectedDate) return;
    apiFetch(`/appointments/taken?doctorId=${selectedDoctor.id}&date=${selectedDate}`, {}, token)
      .then(setTakenSlots)
      .catch(console.error);
  }, [selectedDoctor, selectedDate, token]);

  const handleBook = async () => {
    setLoading(true);
    setError("");
    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({ doctorId: selectedDoctor.id, date: selectedDate, time: selectedTime, reason }),
      }, token);
      setSuccess(true);
      onBook();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>✅</div>
        <h2 style={{ fontFamily: "'Playfair Display', serif", color: "var(--navy)", marginBottom: 12 }}>Wizyta zgłoszona!</h2>
        <p style={{ color: "var(--text-soft)", marginBottom: 32 }}>
          Twoja wizyta u {selectedDoctor.name} dnia {fmt(selectedDate)} o {selectedTime} oczekuje na potwierdzenie.
        </p>
      </div>
    );
  }

  const minDate = new Date().toISOString().split("T")[0];

  return (
    <>
      <div className="page-header">
        <h2>Umów wizytę</h2>
        <p>Wybierz lekarza, termin i powód wizyty</p>
      </div>

      <div className="step-indicator">
        {[["1", "Lekarz"], ["2", "Termin"], ["3", "Szczegóły"]].map(([n, l], i) => (
          <span key={n} style={{ display: "contents" }}>
            {i > 0 && <div className="step-line" />}
            <div className={`step ${step > i ? "done" : step === i + 1 ? "active" : ""}`}>
              <div className="step-num">{step > i + 1 ? "✓" : n}</div>
              <div className="step-label">{l}</div>
            </div>
          </span>
        ))}
      </div>

      {step === 1 && (
        <>
          <h3 style={{ marginBottom: 20, color: "var(--navy)" }}>Wybierz lekarza</h3>
          <div className="doctor-grid">
            {doctors.map(d => (
              <div key={d.id} className={`doctor-card ${selectedDoctor?.id === d.id ? "selected" : ""}`} onClick={() => setSelectedDoctor(d)}>
                <div className="doctor-avatar">{d.avatar}</div>
                <div className="d-name">{d.name}</div>
                <div className="d-spec">{d.specialty}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!selectedDoctor} onClick={() => setStep(2)}>Dalej →</button>
        </>
      )}

      {step === 2 && (
        <>
          <h3 style={{ marginBottom: 20, color: "var(--navy)" }}>Wybierz termin</h3>
          <div className="form-group">
            <label>Data wizyty</label>
            <input type="date" value={selectedDate} min={minDate} onChange={e => { setSelectedDate(e.target.value); setSelectedTime(""); }} />
          </div>
          {selectedDate && (
            <div className="form-group">
              <label>Godzina</label>
              <div className="time-slots">
                {AVAILABLE_SLOTS.map(t => (
                  <button
                    key={t}
                    className={`time-slot ${selectedTime === t ? "selected" : ""} ${takenSlots.includes(t) ? "taken" : ""}`}
                    disabled={takenSlots.includes(t)}
                    onClick={() => setSelectedTime(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)}>← Wróć</button>
            <button className="btn btn-primary" disabled={!selectedDate || !selectedTime} onClick={() => setStep(3)}>Dalej →</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h3 style={{ marginBottom: 20, color: "var(--navy)" }}>Szczegóły wizyty</h3>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Lekarz</div><div style={{ fontWeight: 600, marginTop: 4 }}>{selectedDoctor.name}</div></div>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Data</div><div style={{ fontWeight: 600, marginTop: 4 }}>{fmt(selectedDate)}</div></div>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Godzina</div><div style={{ fontWeight: 600, marginTop: 4 }}>{selectedTime}</div></div>
            </div>
          </div>
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label>Powód wizyty</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Opisz swoje dolegliwości..." />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-outline" onClick={() => setStep(2)}>← Wróć</button>
            <button className="btn btn-sage" disabled={!reason || loading} onClick={handleBook}>
              {loading ? "Zapisywanie..." : "✚ Umów wizytę"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ─── VISIT HISTORY ────────────────────────────────────────────────────────────
function VisitHistory({ appointments }) {
  const [selected, setSelected] = useState(null);
  const completed = appointments.filter(a => a.status === "completed");
  const upcoming  = appointments.filter(a => a.status !== "completed" && a.status !== "cancelled");

  const Section = ({ title, items }) => (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 18, color: "var(--navy)", marginBottom: 16 }}>{title}</h3>
      {items.length === 0 && <p style={{ color: "var(--text-soft)" }}>Brak wizyt</p>}
      <div className="appt-list">
        {items.map(a => (
          <div key={a.id}>
            <div className="appt-item" style={{ cursor: "pointer" }} onClick={() => setSelected(selected?.id === a.id ? null : a)}>
              <div className="appt-date-box">
                <div className="day">{dayNum(a.date)}</div>
                <div className="month">{monthShort(a.date)}</div>
              </div>
              <div className="appt-info">
                <div className="appt-title">{a.doctor?.name}</div>
                <div className="appt-sub">{a.doctor?.specialty} · {a.reason}</div>
              </div>
              <div className="appt-time">{a.time}</div>
              {statusBadge(a.status)}
            </div>
            {selected?.id === a.id && (
              <div className="visit-detail" style={{ marginTop: 8, marginBottom: 8 }}>
                <h4 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "var(--navy)", marginBottom: 16 }}>
                  Szczegóły wizyty — {fmt(a.date)}
                </h4>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Opis / Zalecenia</div>
                  <p>{a.description || <em style={{ color: "var(--text-soft)" }}>Brak opisu</em>}</p>
                </div>
                {a.prescription && (
                  <div className="rx-box">
                    <h4>📋 Recepta</h4>
                    {a.prescription.split("\n").map((rx, i) => <div key={i} className="rx-item">{rx}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <h2>Historia wizyt</h2>
        <p>Twoje wizyty i dokumentacja medyczna</p>
      </div>
      <Section title="Nadchodzące wizyty" items={upcoming} />
      <Section title="Zakończone wizyty" items={completed} />
    </>
  );
}

// ─── DOCTOR SCHEDULE ──────────────────────────────────────────────────────────
function DoctorSchedule({ appointments, onStatusChange, openModal }) {
  const pending   = appointments.filter(a => a.status === "pending");
  const confirmed = appointments.filter(a => a.status === "confirmed");
  const completed = appointments.filter(a => a.status === "completed");

  const ApptRow = ({ a, showActions }) => (
    <div className="appt-item">
      <div className="appt-date-box">
        <div className="day">{dayNum(a.date)}</div>
        <div className="month">{monthShort(a.date)}</div>
      </div>
      <div className="appt-info">
        <div className="appt-title">{a.patient?.name}</div>
        <div className="appt-sub">{a.reason} · {a.time}</div>
      </div>
      {statusBadge(a.status)}
      <div className="appt-actions">
        {showActions === "pending" && (
          <>
            <button className="btn btn-sage btn-sm" onClick={() => onStatusChange(a.id, "confirmed")}>Potwierdź</button>
            <button className="btn btn-outline btn-sm" onClick={() => onStatusChange(a.id, "cancelled")}>Odrzuć</button>
          </>
        )}
        {showActions === "confirmed" && (
          <button className="btn btn-primary btn-sm" onClick={() => openModal({ type: "complete", data: a })}>Zakończ wizytę</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => openModal({ type: "detail", data: a })}>👁</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <h2>Terminarz</h2>
        <p>Zarządzaj swoimi wizytami</p>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3>⏳ Oczekujące na akceptację ({pending.length})</h3></div>
          <div className="card-body">
            <div className="appt-list">{pending.map(a => <ApptRow key={a.id} a={a} showActions="pending" />)}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3>📅 Potwierdzone wizyty ({confirmed.length})</h3></div>
        <div className="card-body">
          {confirmed.length === 0 && <p style={{ color: "var(--text-soft)" }}>Brak potwierdzonych wizyt</p>}
          <div className="appt-list">{confirmed.map(a => <ApptRow key={a.id} a={a} showActions="confirmed" />)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>✅ Historia ({completed.length})</h3></div>
        <div className="card-body">
          {completed.length === 0 && <p style={{ color: "var(--text-soft)" }}>Brak zakończonych wizyt</p>}
          <div className="appt-list">{completed.map(a => <ApptRow key={a.id} a={a} showActions={null} />)}</div>
        </div>
      </div>
    </>
  );
}

// ─── PATIENTS LIST ────────────────────────────────────────────────────────────
function PatientsList({ patients, appointments, openModal }) {
  return (
    <>
      <div className="page-header">
        <h2>Lista pacjentów</h2>
        <p>Wszyscy zarejestrowani pacjenci</p>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Pacjent</th><th>Email</th><th>Telefon</th><th>Wizyty</th><th>Ostatnia wizyta</th><th></th></tr>
            </thead>
            <tbody>
              {patients.map(p => {
                const pAppts = appointments.filter(a => a.patient_id === p.id || a.patientId === p.id);
                const last = pAppts.filter(a => a.status === "completed").sort((a, b) => b.date.localeCompare(a.date))[0];
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{p.avatar}</div>
                        <strong>{p.name}</strong>
                      </div>
                    </td>
                    <td style={{ color: "var(--text-soft)" }}>{p.email}</td>
                    <td style={{ color: "var(--text-soft)" }}>{p.phone || "—"}</td>
                    <td><span className="badge badge-confirmed">{pAppts.length}</span></td>
                    <td style={{ color: "var(--text-soft)" }}>{last ? fmt(last.date) : "—"}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => openModal({ type: "patient", data: p, appointments: pAppts })}>
                        Historia →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── ALL APPOINTMENTS (ADMIN) ─────────────────────────────────────────────────
function AllAppointments({ appointments, onStatusChange }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? appointments : appointments.filter(a => a.status === filter);

  return (
    <>
      <div className="page-header">
        <h2>Wszystkie wizyty</h2>
        <p>Widok administracyjny</p>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {[["all", "Wszystkie"], ["pending", "Oczekujące"], ["confirmed", "Potwierdzone"], ["completed", "Zakończone"], ["cancelled", "Anulowane"]].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${filter === v ? "btn-primary" : "btn-outline"}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Godzina</th><th>Pacjent</th><th>Lekarz</th><th>Powód</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.sort((a, b) => b.date.localeCompare(a.date)).map(a => (
                <tr key={a.id}>
                  <td>{fmt(a.date)}</td>
                  <td>{a.time}</td>
                  <td>{a.patient?.name}</td>
                  <td>{a.doctor?.name}</td>
                  <td style={{ color: "var(--text-soft)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.reason}</td>
                  <td>{statusBadge(a.status)}</td>
                  <td>
                    {a.status === "pending" && (
                      <button className="btn btn-sage btn-sm" onClick={() => onStatusChange(a.id, "confirmed")}>Potwierdź</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ modal, onClose, onComplete, onStatusChange }) {
  const [desc, setDesc] = useState(modal.data?.description || "");
  const [rx,   setRx]   = useState(modal.data?.prescription || "");
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    setLoading(true);
    await onComplete(modal.data.id, desc, rx);
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">

        {modal.type === "detail" && (
          <>
            <div className="modal-header">
              <h3>Szczegóły wizyty</h3>
              <button className="modal-close" onClick={onClose}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Pacjent</div><strong>{modal.data.patient?.name}</strong></div>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Lekarz</div><strong>{modal.data.doctor?.name}</strong></div>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Data i godzina</div><strong>{fmt(modal.data.date)} · {modal.data.time}</strong></div>
              <div><div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Status</div>{statusBadge(modal.data.status)}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Powód wizyty</div>
              <p>{modal.data.reason || "—"}</p>
            </div>
            {modal.data.description && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Opis / Zalecenia</div>
                <p>{modal.data.description}</p>
              </div>
            )}
            {modal.data.prescription && (
              <div className="rx-box">
                <h4>📋 Recepta</h4>
                {modal.data.prescription.split("\n").map((r, i) => <div key={i} className="rx-item">{r}</div>)}
              </div>
            )}
          </>
        )}

        {modal.type === "complete" && (
          <>
            <div className="modal-header">
              <h3>Zakończ wizytę</h3>
              <button className="modal-close" onClick={onClose}>✕</button>
            </div>
            <p style={{ color: "var(--text-soft)", marginBottom: 24 }}>
              Pacjent: <strong>{modal.data.patient?.name}</strong> · {fmt(modal.data.date)} {modal.data.time}
            </p>
            <div className="form-group">
              <label>Opis wizyty / Zalecenia</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Opisz przebieg wizyty i zalecenia dla pacjenta..." />
            </div>
            <div className="form-group">
              <label>Recepta (opcjonalnie — każdy lek w nowej linii)</label>
              <textarea value={rx} onChange={e => setRx(e.target.value)} placeholder={"Amoksycylina 500mg 3x1 przez 7 dni\nIbuprofen 400mg do 3x1 w razie bólu"} />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn btn-outline" onClick={onClose}>Anuluj</button>
              <button className="btn btn-sage" onClick={handleComplete} disabled={!desc || loading}>
                {loading ? "Zapisywanie..." : "✅ Zakończ wizytę"}
              </button>
            </div>
          </>
        )}

        {modal.type === "patient" && (
          <>
            <div className="modal-header">
              <h3>Historia: {modal.data.name}</h3>
              <button className="modal-close" onClick={onClose}>✕</button>
            </div>
            <p style={{ color: "var(--text-soft)", marginBottom: 24 }}>{modal.data.email} · {modal.data.phone || "Brak telefonu"}</p>
            {(!modal.appointments || modal.appointments.length === 0) && <p style={{ color: "var(--text-soft)" }}>Brak wizyt</p>}
            <div className="appt-list">
              {modal.appointments?.sort((a, b) => b.date.localeCompare(a.date)).map(a => (
                <div key={a.id} className="appt-item">
                  <div className="appt-date-box">
                    <div className="day">{dayNum(a.date)}</div>
                    <div className="month">{monthShort(a.date)}</div>
                  </div>
                  <div className="appt-info">
                    <div className="appt-title">{a.doctor?.name}</div>
                    <div className="appt-sub">{a.reason}</div>
                  </div>
                  <div className="appt-time">{a.time}</div>
                  {statusBadge(a.status)}
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── PROFILE SETTINGS ─────────────────────────────────────────────────────────
function ProfileSettings({ user, token, onUpdate, onDelete }) {
  const [name, setName]         = useState(user.name || "");
  const [email, setEmail]       = useState(user.email || "");
  const [phone, setPhone]       = useState(user.phone || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (password && password !== confirm) return setError("Hasła nie są zgodne");
    if (password && password.length < 6) return setError("Hasło musi mieć minimum 6 znaków");
    setLoading(true);
    try {
      const body = { name, email, phone, ...(password ? { password } : {}) };
      const { token: newToken, user: newUser } = await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(body) }, token);
      onUpdate(newToken, newUser);
      setSuccess("Dane zostały zaktualizowane!");
      setPassword(""); setConfirm("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await apiFetch('/users/me', { method: 'DELETE' }, token);
      onDelete();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Ustawienia profilu</h2>
        <p>Zarządzaj swoimi danymi osobowymi</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

        {/* Dane osobowe */}
        <div className="card">
          <div className="card-header"><h3>👤 Dane osobowe</h3></div>
          <div className="card-body">
            {error   && <div className="error-msg">{error}</div>}
            {success && <div className="success-msg">✅ {success}</div>}
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Imię i nazwisko</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Jan Kowalski" required />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="twoj@email.pl" required />
              </div>
              <div className="form-group">
                <label>Telefon</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="600 123 456" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Zapisywanie..." : "Zapisz zmiany"}
              </button>
            </form>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Zmiana hasła */}
          <div className="card">
            <div className="card-header"><h3>🔒 Zmiana hasła</h3></div>
            <div className="card-body">
              <div className="form-group">
                <label>Nowe hasło</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="minimum 6 znaków" />
              </div>
              <div className="form-group">
                <label>Powtórz hasło</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
              </div>
              <p style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 16 }}>
                Zostaw puste jeśli nie chcesz zmieniać hasła.
              </p>
              <button className="btn btn-outline" disabled={!password || loading} onClick={handleSave}>
                Zmień hasło
              </button>
            </div>
          </div>

          {/* Strefa niebezpieczna — tylko pacjent */}
          {user.role === "patient" && (
            <div className="card" style={{ borderColor: "#ffcdd2" }}>
              <div className="card-header" style={{ background: "#fff5f5" }}>
                <h3 style={{ color: "var(--rust)" }}>⚠️ Strefa niebezpieczna</h3>
              </div>
              <div className="card-body">
                <p style={{ fontSize: 14, color: "var(--text-soft)", marginBottom: 16 }}>
                  Usunięcie konta jest nieodwracalne. Wszystkie Twoje dane zostaną skasowane, a nadchodzące wizyty anulowane.
                </p>
                {!showDelete ? (
                  <button className="btn btn-rust btn-sm" onClick={() => setShowDelete(true)}>
                    Usuń konto
                  </button>
                ) : (
                  <div style={{ background: "#fff0ed", border: "1px solid var(--rust-light)", borderRadius: "var(--radius-sm)", padding: 16 }}>
                    <p style={{ fontWeight: 600, marginBottom: 12, color: "var(--rust)" }}>Czy na pewno chcesz usunąć konto?</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-rust btn-sm" onClick={handleDelete}>Tak, usuń konto</button>
                      <button className="btn btn-outline btn-sm" onClick={() => setShowDelete(false)}>Anuluj</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}