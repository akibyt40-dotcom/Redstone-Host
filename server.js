require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database("redstone-host.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  discord_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  term TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  ram_gb INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending setup',
  server_version TEXT,
  software TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES tickets(id),
  FOREIGN KEY(sender_id) REFERENCES users(id)
);
`);
for (const [column, type] of [["server_version","TEXT"],["software","TEXT"]]) {
  try { db.exec(`ALTER TABLE servers ADD COLUMN ${column} ${type}`); } catch (err) { if (!String(err.message).includes("duplicate column name")) throw err; }
}

const plans = [
  {id:"stone", name:"Stone Plan", ram:2, price:0, free:true},
  {id:"iron", name:"Iron Plan", ram:3, price:195},
  {id:"gold", name:"Gold Plan", ram:4, price:390},
  {id:"diamond", name:"Diamond Plan", ram:5, price:585},
  {id:"netherite", name:"Netherite Plan", ram:6, price:780},
  {id:"emerald", name:"Emerald Plan", ram:7, price:975},
  {id:"redstone", name:"Redstone Plan", ram:8, price:1170}
];

function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !email || !password || password === "SET_A_STRONG_PASSWORD_HERE") {
    console.warn("Admin not bootstrapped. Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env.");
    return;
  }
  const existing = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,'admin')")
      .run(username, email, hash);
    console.log("Initial admin account created from environment settings.");
  }
}
bootstrapAdmin();

// Add Discord account linking to databases created by older versions.
try { db.exec("ALTER TABLE users ADD COLUMN discord_id TEXT"); }
catch (err) { if (!String(err.message).includes("duplicate column name")) throw err; }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_unique ON users(discord_id) WHERE discord_id IS NOT NULL"); }
catch (err) { throw err; }

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "rh.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000*60*60*8 }
}));
app.use(express.static(path.join(__dirname, "public")));

const loginLimiter = rateLimit({windowMs: 15*60*1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false});
const findUser = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE");

// Discord OAuth2. Set DISCORD_REDIRECT_URI to this exact callback URL in both
// the Discord Developer Portal and the server environment.
function discordOAuthReady() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_REDIRECT_URI);
}
app.get("/auth/discord", (req, res) => {
  if (!discordOAuthReady()) return res.status(503).send("Discord login is not configured yet.");
  const state = crypto.randomBytes(24).toString("hex");
  req.session.discordOAuthState = state;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify email",
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect("/?discord_error=cancelled");
  if (!code || !state || !req.session.discordOAuthState || state !== req.session.discordOAuthState) {
    delete req.session.discordOAuthState;
    return res.status(400).send("Invalid Discord OAuth state. Please try signing in again.");
  }
  delete req.session.discordOAuthState;
  if (!discordOAuthReady()) return res.status(503).send("Discord login is not configured yet.");

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Discord token exchange failed");

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userResponse.json();
    if (!userResponse.ok || !discordUser.id) throw new Error("Could not read Discord account");
    if (!discordUser.email || discordUser.verified !== true) {
      return res.redirect("/?discord_error=verified_email_required");
    }

    let user = db.prepare("SELECT * FROM users WHERE discord_id=?").get(String(discordUser.id));
    if (!user) {
      // Link an existing account only when Discord confirms the same email.
      user = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(String(discordUser.email));
      if (user) {
        db.prepare("UPDATE users SET discord_id=? WHERE id=?").run(String(discordUser.id), user.id);
        user = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      } else {
        const base = String(discordUser.username || "discord-user").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 18) || "discord-user";
        let username = base;
        while (db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE").get(username)) {
          username = `${base.slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`;
        }
        const randomPassword = crypto.randomBytes(48).toString("hex");
        const passwordHash = bcrypt.hashSync(randomPassword, 12);
        const result = db.prepare("INSERT INTO users (username,email,password_hash,discord_id) VALUES (?,?,?,?)")
          .run(username, String(discordUser.email).toLowerCase(), passwordHash, String(discordUser.id));
        user = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
      }
    }

    req.session.regenerate((sessionError) => {
      if (sessionError) return res.redirect("/?discord_error=login_failed");
      req.session.user = safeUser(user);
      req.session.save((saveError) => {
        if (saveError) return res.redirect("/?discord_error=login_failed");
        res.redirect("/?discord=connected");
      });
    });
  } catch (err) {
    console.error("Discord OAuth error:", err.message);
    res.redirect("/?discord_error=login_failed");
  }
});

function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Please sign in first."});
  next();
}
function requireAdmin(req,res,next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({error:"Not allowed."});
  next();
}
function safeUser(u) { return {id:u.id, username:u.username, email:u.email, role:u.role}; }

app.post("/api/register", loginLimiter, async (req,res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
    return res.status(400).json({error:"Use a 3–24 character username, valid email and password of at least 10 characters."});
  try {
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)").run(username,email,hash);
    req.session.user = safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid));
    res.json({user:req.session.user});
  } catch { res.status(409).json({error:"That username or email is already registered."}); }
});

app.post("/api/login", loginLimiter, async (req,res) => {
  const identity = String(req.body.identity || "").trim();
  const password = String(req.body.password || "");
  const user = findUser.get(identity, identity);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({error:"Email/username or password is incorrect."});
  req.session.user = safeUser(user);
  res.json({user:req.session.user});
});
app.post("/api/logout", (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get("/api/me", (req,res) => res.json({user:req.session.user || null}));
app.get("/api/plans", (req,res) => res.json({plans}));
app.get("/api/servers", requireAuth, (req,res) => {
  const rows = db.prepare("SELECT id,name,plan_id,ram_gb,status,created_at FROM servers WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
  res.json({servers:rows});
});
app.get("/api/orders", requireAuth, (req,res) => {
  const rows = db.prepare("SELECT id,plan_id,term,amount,status,created_at FROM orders WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
  res.json({orders:rows});
});
app.post("/api/orders", requireAuth, (req,res) => {
  const plan = plans.find(p => p.id === req.body.planId);
  const term = plan && plan.id === "stone" ? "FREE/12MIN" : (req.body.term === "quarterly" ? "quarterly" : "monthly");
  if (!plan) return res.status(400).json({error:"Unknown plan."});
  const amount = plan.price * (term === "quarterly" ? 3 : 1);
  const create = db.transaction(() => {
    const order = db.prepare("INSERT INTO orders (user_id,plan_id,term,amount) VALUES (?,?,?,?)")
      .run(req.session.user.id, plan.id, term, amount);
    const ticket = db.prepare("INSERT INTO tickets (order_id,user_id,subject) VALUES (?,?,?)")
      .run(order.lastInsertRowid, req.session.user.id, `Deploy request - ${plan.name}`);
    const welcome = plan.price === 0
      ? "Hi! I want to deploy the " + plan.name + " (FREE). Please guide me through the setup."
      : "Hi! I want a " + plan.name + " server. Please tell me the payment method and how to pay ৳" + amount + ".";
    db.prepare("INSERT INTO ticket_messages (ticket_id,sender_id,sender_role,message) VALUES (?,?,?,?)")
      .run(ticket.lastInsertRowid, req.session.user.id, "user", welcome);
    return {orderId:order.lastInsertRowid,ticketId:ticket.lastInsertRowid};
  });
  const result = create();
  res.json({ok:true, ...result, message:"Deploy request created. Your support ticket is ready; continue the conversation there for payment instructions and setup."});
});
app.get("/api/tickets", requireAuth, (req,res) => {
  const rows = db.prepare(`SELECT t.*, o.plan_id, o.term, o.amount, o.status AS order_status
    FROM tickets t JOIN orders o ON o.id=t.order_id
    WHERE t.user_id=? ORDER BY t.updated_at DESC, t.id DESC`).all(req.session.user.id);
  res.json({tickets:rows});
});
app.get("/api/tickets/:id/messages", requireAuth, (req,res) => {
  const ticket = db.prepare("SELECT * FROM tickets WHERE id=?").get(Number(req.params.id));
  if (!ticket || (req.session.user.role !== "admin" && ticket.user_id !== req.session.user.id))
    return res.status(404).json({error:"Ticket not found."});
  const messages = db.prepare(`SELECT m.id,m.sender_role,m.message,m.created_at,u.username
    FROM ticket_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.ticket_id=? ORDER BY m.id ASC`).all(ticket.id);
  res.json({ticket,messages});
});
app.post("/api/tickets/:id/messages", requireAuth, (req,res) => {
  const ticket = db.prepare("SELECT * FROM tickets WHERE id=?").get(Number(req.params.id));
  if (!ticket || (req.session.user.role !== "admin" && ticket.user_id !== req.session.user.id))
    return res.status(404).json({error:"Ticket not found."});
  const message = String(req.body.message || "").trim().slice(0,2000);
  if (!message) return res.status(400).json({error:"Write a message first."});
  db.prepare("INSERT INTO ticket_messages (ticket_id,sender_id,sender_role,message) VALUES (?,?,?,?)")
    .run(ticket.id, req.session.user.id, req.session.user.role, message);
  db.prepare("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP, status=CASE WHEN ?='admin' THEN 'waiting_customer' ELSE 'open' END WHERE id=?")
    .run(req.session.user.role,ticket.id);
  res.json({ok:true});
});
app.post("/api/admin/tickets/:id/status", requireAdmin, (req,res) => {
  const allowed=["open","waiting_customer","paid","approved","closed"];
  const status=String(req.body.status||"");
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid ticket status."});
  const result=db.prepare("UPDATE tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Ticket not found."});
  res.json({ok:true});
});
app.get("/api/admin/tickets", requireAdmin, (req,res) => {
  const rows=db.prepare(`SELECT t.*,o.plan_id,o.term,o.amount,o.status AS order_status,
    u.username,u.email FROM tickets t JOIN orders o ON o.id=t.order_id
    JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC,t.id DESC`).all();
  res.json({tickets:rows});
});
app.get("/api/admin/orders", requireAdmin, (req,res) => {
  const rows = db.prepare(`SELECT orders.*, users.username, users.email FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC`).all();
  res.json({orders:rows});
});
app.get("/api/admin/servers", requireAdmin, (req,res) => {
  const rows=db.prepare(`SELECT s.id,s.name,s.status,s.server_version,s.software,s.created_at,u.username,u.email
    FROM servers s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100`).all();
  res.json({servers:rows});
});
app.post("/api/admin/servers", requireAdmin, (req,res) => {
  const serverName=String(req.body.serverName||"").trim().slice(0,40);
  const ownerIdentity=String(req.body.ownerIdentity||"").trim();
  if (!serverName) return res.status(400).json({error:"Enter a server name."});
  if (!ownerIdentity) return res.status(400).json({error:"Enter the owner's email or username."});
  const owner=findUser.get(ownerIdentity,ownerIdentity);
  if (!owner || owner.role === "admin") return res.status(404).json({error:"Customer account not found. Use a registered customer's username or email."});
  const result=db.prepare(`INSERT INTO servers (user_id,name,plan_id,ram_gb,status,server_version,software)
    VALUES (?,?, 'admin-assigned',0,'Pending VPS setup',NULL,NULL)`).run(owner.id,serverName);
  res.json({ok:true,serverId:result.lastInsertRowid,owner:safeUser(owner),message:"Server record created. VPS provisioning is not connected yet."});
});
app.post("/api/admin/orders/:id/approve", requireAdmin, (req,res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND status='pending'").get(Number(req.params.id));
  if (!order) return res.status(404).json({error:"Pending order not found."});
  const plan = plans.find(p=>p.id===order.plan_id);
  const serverName = String(req.body.serverName || `${plan.name} Server`).trim().slice(0,40);
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status='approved' WHERE id=?").run(order.id);
    db.prepare("INSERT INTO servers (user_id,name,plan_id,ram_gb,status) VALUES (?,?,?,?,?)")
      .run(order.user_id,serverName,plan.id,plan.ram,"Pending manual setup");
  });
  tx();
  res.json({ok:true,message:"Order approved. Server record created as pending manual setup; no game server is auto-provisioned."});
});
app.post("/api/admin/orders/:id/reject", requireAdmin, (req,res) => {
  const result = db.prepare("UPDATE orders SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Pending order not found."});
  res.json({ok:true});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`Redstone Host running at http://localhost:${PORT}`));
