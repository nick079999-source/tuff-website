// server.js  ─  Node.js + Express backend
// Run:  node server.js
// Saves every visit to visits.json and shows a dashboard at /dashboard

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const https   = require("https");

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "visits.json");

app.use(express.json());
app.use(express.static(__dirname)); // serves tracker.html at /tracker.html

// ── Helper: read saved visits ────────────────────────────────────────
function readVisits() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch(e) { return []; }
}

// ── Helper: get real IP from request ────────────────────────────────
function getIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// ── Helper: IP geo-lookup via ip-api.com (free, no key needed) ──────
function lookupIP(ip) {
  return new Promise((resolve) => {
    // Skip lookup for local IPs
    if (ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168")) {
      return resolve({ note: "Local/private IP — no geo available" });
    }
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,lat,lon,isp,org,as,query`;
    require("http").get(url, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve({}); }
      });
    }).on("error", () => resolve({}));
  });
}

// ── POST /track  ─  receives data from tracker.html ─────────────────
app.post("/track", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  const ip   = getIP(req);
  const geo  = await lookupIP(ip);
  const visit = {
    id:        Date.now(),
    ip,
    ipGeo:     geo,
    ...req.body
  };

  const visits = readVisits();
  visits.unshift(visit); // newest first
  fs.writeFileSync(DATA_FILE, JSON.stringify(visits, null, 2));
  console.log(`✅ New visit from IP: ${ip}`);
  res.json({ ok: true });
});

// ── OPTIONS preflight ────────────────────────────────────────────────
app.options("/track", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

// ── GET /data  ─  raw JSON of all visits ────────────────────────────
app.get("/data", (req, res) => {
  res.json(readVisits());
});

// ── GET /dashboard  ─  pretty admin dashboard ───────────────────────
app.get("/dashboard", (req, res) => {
  const visits = readVisits();
  res.send(buildDashboard(visits));
});

// ── Dashboard HTML builder ───────────────────────────────────────────
function buildDashboard(visits) {
  const rows = visits.map(v => {
    const geo = v.ipGeo || {};
    const loc = geo.city ? `${geo.city}, ${geo.regionName}, ${geo.country}` : (v.geolocation ? `${v.geolocation.latitude?.toFixed(4)}, ${v.geolocation.longitude?.toFixed(4)}` : "—");
    const ua  = v.userAgent || "—";
    const dev = guessDevice(ua);
    const time = v.visitTime ? new Date(v.visitTime).toLocaleString() : "—";
    return `
      <tr>
        <td><code>${v.ip || "—"}</code></td>
        <td>${loc}</td>
        <td title="${ua}">${dev}</td>
        <td>${v.screenRes || "—"}</td>
        <td>${v.timezone || "—"}</td>
        <td>${v.language || "—"}</td>
        <td>${v.connectionType || "—"}</td>
        <td>${v.battery ? v.battery.level + (v.battery.charging ? " ⚡" : "") : "—"}</td>
        <td>${v.referrer || "direct"}</td>
        <td>${time}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Tracker Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --border: #1e1e2e;
      --accent: #7c3aed;
      --accent2: #06b6d4;
      --text: #e2e8f0;
      --muted: #64748b;
      --green: #10b981;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--text); font-family:'Syne',sans-serif; min-height:100vh; }
    
    header {
      padding: 2rem 3rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 1rem;
      background: linear-gradient(135deg, #0a0a0f 0%, #12121a 100%);
    }
    .logo { font-size:1.8rem; font-weight:800; background: linear-gradient(135deg,var(--accent),var(--accent2)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .badge { background:var(--accent); color:#fff; font-size:.7rem; padding:.2rem .5rem; border-radius:99px; font-family:'JetBrains Mono',monospace; }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      padding: 2rem 3rem;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.2rem 1.5rem;
    }
    .stat-label { font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    .stat-val { font-size:2rem; font-weight:800; margin-top:.3rem; }
    
    .table-wrap { padding: 0 3rem 3rem; overflow-x: auto; }
    h2 { font-size:1rem; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; margin-bottom:1rem; }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th {
      background: var(--surface);
      color: var(--muted);
      font-family:'JetBrains Mono',monospace;
      font-size:.7rem;
      text-transform:uppercase;
      letter-spacing:.08em;
      padding:.8rem 1rem;
      text-align:left;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td {
      padding:.75rem 1rem;
      border-bottom: 1px solid var(--border);
      vertical-align:middle;
      font-family:'JetBrains Mono',monospace;
      font-size:.78rem;
      max-width:200px;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    tr:hover td { background: #ffffff08; }
    code { color:var(--accent2); }
    .refresh { margin-left:auto; background:var(--accent); color:#fff; border:none; padding:.5rem 1.2rem; border-radius:8px; cursor:pointer; font-family:'Syne',sans-serif; font-size:.85rem; }
    .refresh:hover { background:#6d28d9; }
    .empty { text-align:center; padding:4rem; color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="logo">LinkTracker</div>
      <div style="font-size:.8rem;color:var(--muted);margin-top:.2rem;">Admin Dashboard</div>
    </div>
    <span class="badge">${visits.length} visits</span>
    <button class="refresh" onclick="location.reload()">↻ Refresh</button>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total Visits</div>
      <div class="stat-val" style="color:var(--accent)">${visits.length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Unique IPs</div>
      <div class="stat-val" style="color:var(--accent2)">${new Set(visits.map(v=>v.ip)).size}</div>
    </div>
    <div class="stat">
      <div class="stat-label">With Geolocation</div>
      <div class="stat-val" style="color:var(--green)">${visits.filter(v=>v.geolocation?.latitude).length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Latest Visit</div>
      <div class="stat-val" style="font-size:1rem;color:var(--text)">${visits[0] ? new Date(visits[0].visitTime).toLocaleTimeString() : "—"}</div>
    </div>
  </div>

  <div class="table-wrap">
    <h2>Visit Log</h2>
    ${visits.length === 0 ? '<div class="empty">No visits yet. Share your tracker link to get started.</div>' : `
    <table>
      <thead>
        <tr>
          <th>IP Address</th>
          <th>Location</th>
          <th>Device / Browser</th>
          <th>Screen</th>
          <th>Timezone</th>
          <th>Language</th>
          <th>Connection</th>
          <th>Battery</th>
          <th>Referrer</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`}
  </div>
</body>
</html>`;
}

function guessDevice(ua) {
  if (!ua) return "Unknown";
  if (/iPhone/i.test(ua)) return "📱 iPhone";
  if (/iPad/i.test(ua)) return "📱 iPad";
  if (/Android.*Mobile/i.test(ua)) return "📱 Android Phone";
  if (/Android/i.test(ua)) return "📱 Android Tablet";
  if (/Windows Phone/i.test(ua)) return "📱 Windows Phone";
  if (/Windows/i.test(ua)) return "🖥 Windows PC";
  if (/Macintosh/i.test(ua)) return "🖥 Mac";
  if (/Linux/i.test(ua)) return "🖥 Linux";
  return "🖥 Desktop";
}

app.listen(PORT, () => {
  console.log(`\n🚀 Tracker running at http://localhost:${PORT}`);
  console.log(`   Tracker page : http://localhost:${PORT}/tracker.html`);
  console.log(`   Dashboard    : http://localhost:${PORT}/dashboard`);
  console.log(`   Raw JSON     : http://localhost:${PORT}/data\n`);
});
