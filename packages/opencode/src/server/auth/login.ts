export namespace LoginPage {
  const LOGO = `
 ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║██║  ██║█████╗
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║  ██║██╔══╝
╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝██████╔╝███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝`.trim()

  const STYLE = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      background: #0a0a0a; color: #e0e0e0; display: flex; align-items: center;
      justify-content: center; min-height: 100vh;
    }
    .container { width: 100%; max-width: 420px; padding: 2rem; }
    .logo { color: #7c3aed; font-size: 0.35rem; line-height: 1.1; white-space: pre; margin-bottom: 2rem; text-align: center; }
    h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; text-align: center; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
    input {
      width: 100%; padding: 0.6rem 0.75rem; background: #1a1a1a; border: 1px solid #333;
      border-radius: 6px; color: #e0e0e0; font-family: inherit; font-size: 0.9rem;
      outline: none; transition: border-color 0.15s;
    }
    input:focus { border-color: #7c3aed; }
    button {
      width: 100%; padding: 0.7rem; background: #7c3aed; color: #fff; border: none;
      border-radius: 6px; font-family: inherit; font-size: 0.9rem; font-weight: 600;
      cursor: pointer; transition: background 0.15s; margin-top: 0.5rem;
    }
    button:hover { background: #6d28d9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #ef4444; font-size: 0.8rem; margin-top: 0.75rem; text-align: center; display: none; }
    .error.visible { display: block; }
  `.trim()

  function script(endpoint: string, redirect: string) {
    return `
      const form = document.getElementById('form');
      const error = document.getElementById('error');
      const btn = document.getElementById('btn');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.className = 'error';
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        const body = {};
        new FormData(form).forEach((v, k) => { body[k] = v; });
        try {
          const res = await fetch('${endpoint}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Authentication failed');
          }
          window.location.href = '${redirect}';
        } catch (err) {
          error.textContent = err.message;
          error.className = 'error visible';
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
      });
    `.trim()
  }

  export function login() {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>opencode - sign in</title><style>${STYLE}</style></head>
<body><div class="container">
<pre class="logo">${LOGO}</pre>
<h2>Sign In</h2>
<form id="form">
  <div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" required autofocus></div>
  <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
  <button id="btn" type="submit">Sign In</button>
  <div id="error" class="error"></div>
</form>
</div><script>${script("/web-auth/login", "/")}</script></body></html>`
  }

  export function setup() {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>opencode - setup</title><style>${STYLE}</style></head>
<body><div class="container">
<pre class="logo">${LOGO}</pre>
<h2>Create Admin Account</h2>
<form id="form">
  <div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" required autofocus></div>
  <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8"></div>
  <button id="btn" type="submit">Create Admin</button>
  <div id="error" class="error"></div>
</form>
</div><script>${script("/web-auth/setup", "/")}</script></body></html>`
  }
}
