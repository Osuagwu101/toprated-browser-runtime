import http from 'node:http';

const port = Number(process.env.PHASE10_MULTI_AUTH_FIXTURE_PORT || 19093);

function html(response, body) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  });
  response.end(body);
}

function hasCookie(request, expected) {
  return String(request.headers.cookie || '')
    .split(';')
    .map((value) => value.trim())
    .includes(expected);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);

  if (requestUrl.pathname === '/health') {
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
    });
    response.end(JSON.stringify({
      status: 'ok',
      tools: ['stealthwriter', 'chatgpt'],
      purpose: 'phase10-multi-tool-auth-portability',
    }));
    return;
  }

  if (requestUrl.pathname === '/stealthwriter/sign-in') {
    html(response, '<!doctype html><html><head><title>STEALTHWRITER_SIGN_IN</title></head><body><main data-tool="stealthwriter" data-authenticated="false">Sign in</main></body></html>');
    return;
  }

  if (requestUrl.pathname === '/stealthwriter/dashboard') {
    if (!hasCookie(request, 'stealthwriter-session=valid')) {
      response.writeHead(302, {
        location: '/stealthwriter/sign-in',
        'cache-control': 'no-store, max-age=0',
      });
      response.end();
      return;
    }
    html(response, '<!doctype html><html><head><title>STEALTHWRITER_AUTHENTICATED</title></head><body><main data-tool="stealthwriter" data-authenticated="true">Stealthwriter authenticated workspace</main></body></html>');
    return;
  }

  if (requestUrl.pathname === '/chatgpt/' || requestUrl.pathname === '/chatgpt') {
    html(response, `<!doctype html><html><head><meta charset="utf-8"><title>CHATGPT_CHECKING</title></head><body>
      <main id="app" data-tool="chatgpt"></main>
      <script>
        const cookieOk = document.cookie.split(';').map(v => v.trim()).includes('chatgpt-session=valid');
        const localOk = localStorage.getItem('chatgpt-auth') === 'shared-valid';
        const authenticated = cookieOk && localOk;
        document.title = authenticated ? 'CHATGPT_AUTHENTICATED' : 'CHATGPT_LOGGED_OUT';
        const app = document.getElementById('app');
        app.setAttribute('data-authenticated', authenticated ? 'true' : 'false');
        if (authenticated) {
          const profile = document.createElement('button');
          profile.setAttribute('data-testid', 'accounts-profile-button');
          profile.setAttribute('aria-label', 'Open profile menu');
          profile.textContent = 'Authenticated account';
          app.appendChild(profile);
        } else {
          const login = document.createElement('button');
          login.textContent = 'Log in';
          app.appendChild(login);
        }
      </script>
    </body></html>`);
    return;
  }

  if (requestUrl.pathname === '/chatgpt/logged-out') {
    html(response, '<!doctype html><html><head><title>CHATGPT_LOGGED_OUT</title></head><body><main data-tool="chatgpt" data-authenticated="false"><button>Log in</button></main></body></html>');
    return;
  }

  response.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  });
  response.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'phase10_multi_auth_fixture_started', port }));
});
