/**
 * Demo "ORCA Shop" — the application under test used by the mock setup.
 * It intentionally ships with one product defect (discount calculation) so the
 * Failure Analysis Agent has something real to investigate.
 */
import express from 'express';
import { pathToFileURL } from 'node:url';

const VERSION = '1.4.2';
const USER = { email: 'demo@orca.dev', password: 'orca123', name: 'Demo User' };
const PRODUCTS = [
  { id: 1, name: 'Mechanical Keyboard', price: 100.0, stock: 12 },
  { id: 2, name: 'Wireless Mouse', price: 35.5, stock: 40 },
  { id: 3, name: 'USB-C Hub', price: 49.9, stock: 0 },
];
const DISCOUNTS = { SAVE10: 1000 }; // basis points

const logs = [];
function log(level, msg) {
  logs.push({ ts: new Date().toISOString(), level, msg });
  if (logs.length > 500) logs.shift();
}

const money = (n) => `$${n.toFixed(2)}`;

const layout = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ORCA Shop</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1f2933}
  nav a{margin-right:12px} form{display:grid;gap:10px;margin:16px 0} input{padding:8px;font-size:15px}
  button{padding:9px 14px;font-size:15px;cursor:pointer} .error{color:#b42318} .ok{color:#067647}
  table{width:100%;border-collapse:collapse} td{padding:6px 0;border-bottom:1px solid #eee}
</style></head>
<body><nav><a href="/">Home</a><a href="/cart">Cart</a><a href="/login">Login</a><a href="/reset-password">Reset password</a></nav>
<h1>${title}</h1>${body}</body></html>`;

const loginPage = (error = '') =>
  layout(
    'Sign in',
    `<form method="post" action="/login">
      <label>Email <input data-testid="login-email" name="email" type="email" autocomplete="username"></label>
      <label>Password <input data-testid="login-password" name="password" type="password" autocomplete="current-password"></label>
      <button data-testid="login-submit" type="submit">Sign in</button>
    </form>${error ? `<p class="error" data-testid="login-error">${error}</p>` : ''}`,
  );

function cartPage({ code = '', message = '', error = '' } = {}) {
  const subtotal = PRODUCTS[0].price;
  let total = subtotal;
  if (code && DISCOUNTS[code]) {
    // BUG (intentional): basis points divided by 100000 instead of 10000 → 1% instead of 10%.
    const rate = DISCOUNTS[code] / 100000;
    total = subtotal * (1 - rate);
    log('info', `[cart] discount ${code} applied: bps=${DISCOUNTS[code]} rate=${rate} subtotal=${subtotal.toFixed(2)} total=${total.toFixed(2)}`);
    if (rate < 0.05) log('warn', `[pricing] discount ${code} rate ${rate} lower than configured campaign rate 0.10`);
  }
  return layout(
    'Your cart',
    `<table><tr><td>${PRODUCTS[0].name}</td><td>${money(subtotal)}</td></tr>
      <tr><td>Subtotal</td><td data-testid="cart-subtotal">${money(subtotal)}</td></tr>
      <tr><td><strong>Total</strong></td><td><strong data-testid="cart-total">${money(total)}</strong></td></tr></table>
    <form method="post" action="/cart/discount">
      <label>Discount code <input data-testid="discount-code" name="code" value="${code.replace(/"/g, '')}"></label>
      <button data-testid="apply-discount" type="submit">Apply</button>
    </form>
    ${message ? `<p class="ok" data-testid="discount-message">${message}</p>` : ''}
    ${error ? `<p class="error" data-testid="discount-error">${error}</p>` : ''}`,
  );
}

export function createDemoApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => {
    if (!req.path.startsWith('/__logs')) log('info', `${req.method} ${req.path}`);
    next();
  });
  const authed = (req) => /(?:^|;\s*)session=demo/.test(req.headers.cookie || '');
  const requireAuth = (req, res, next) => (authed(req) ? next() : res.redirect('/login'));

  app.get('/', (_req, res) => res.send(layout('ORCA Shop', `<p data-testid="home-title">Welcome to the ORCA demo shop.</p>`)));
  app.get('/login', (_req, res) => res.send(loginPage()));
  app.post('/login', (req, res) => {
    if (req.body.email === USER.email && req.body.password === USER.password) {
      log('info', `[auth] login ok for ${req.body.email}`);
      res.setHeader('Set-Cookie', 'session=demo; Path=/; HttpOnly; SameSite=Lax');
      return res.redirect('/dashboard');
    }
    log('warn', `[auth] failed login for ${req.body.email || '(empty)'}`);
    res.status(401).send(loginPage('Invalid email or password'));
  });
  app.get('/dashboard', requireAuth, (_req, res) => res.send(layout('Dashboard', `<p data-testid="welcome-message">Welcome back, ${USER.name}</p>`)));
  app.get('/cart', requireAuth, (_req, res) => res.send(cartPage()));
  app.post('/cart/discount', requireAuth, (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!DISCOUNTS[code]) {
      log('info', `[cart] rejected discount code ${code || '(empty)'}`);
      return res.send(cartPage({ error: 'Invalid discount code' }));
    }
    res.send(cartPage({ code, message: `Discount ${code} applied` }));
  });
  app.get('/reset-password', (_req, res) =>
    res.send(
      layout(
        'Reset password',
        `<form method="post" action="/reset-password">
          <label>Email <input data-testid="reset-email-input" name="email" type="email"></label>
          <button data-testid="reset-submit" type="submit">Send reset link</button>
        </form>`,
      ),
    ),
  );
  app.post('/reset-password', (_req, res) => res.send(layout('Reset password', `<p class="ok" data-testid="reset-confirmation">If an account exists, a reset link has been sent</p>`)));

  app.get('/api/products', (_req, res) => res.json({ items: PRODUCTS }));
  app.get('/api/products/:id', (req, res) => {
    const p = PRODUCTS.find((x) => x.id === Number(req.params.id));
    return p ? res.json(p) : res.status(404).json({ error: 'Product not found' });
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', version: VERSION, uptimeSec: Math.round(process.uptime()) }));
  app.get('/__logs', (req, res) => res.json({ lines: logs.filter((l) => !req.query.since || l.ts >= req.query.since) }));
  return app;
}

export function startDemoApp({ port = 4100, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createDemoApp().listen(port, host, () => {
      console.log(`Demo app (ORCA Shop) listening on http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDemoApp({ port: Number(process.env.DEMO_APP_PORT) || 4100 });
}
