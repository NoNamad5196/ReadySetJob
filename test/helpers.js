const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');

function createTestContext() {
  process.env.NODE_ENV = 'test';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readysetjob-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const app = createApp({ dbPath });

  function cleanup() {
    if (app.db && app.db.open) {
      app.db.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { app, db: app.db, dbPath, cleanup };
}

function extractCsrfToken(html) {
  const metaMatch = String(html).match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
  if (metaMatch) {
    return metaMatch[1];
  }
  const inputMatch = String(html).match(/name="_csrf"\s+value="([^"]+)"/i);
  return inputMatch ? inputMatch[1] : '';
}

async function fetchCsrfToken(agent, urlPath = '/login') {
  const res = await agent.get(urlPath);
  return extractCsrfToken(res.text);
}

async function signupAndLogin(
  app,
  {
    email = 'tester@readysetjob.dev',
    password = 'password123!',
    name = '홍길동',
  } = {}
) {
  const agent = request.agent(app);
  const initialCsrf = await fetchCsrfToken(agent, '/signup');

  const signupRes = await agent.post('/signup').type('form').send({
    _csrf: initialCsrf,
    email,
    password,
    name,
  });

  if (signupRes.status !== 302) {
    throw new Error(`Expected 302 on signup, got ${signupRes.status}`);
  }

  const csrfToken = await fetchCsrfToken(agent, '/dashboard');
  return {
    agent,
    csrfToken,
    async refreshCsrf() {
      return fetchCsrfToken(agent, '/dashboard');
    },
  };
}

async function loginAgent(app, { email, password }) {
  const agent = request.agent(app);
  const initialCsrf = await fetchCsrfToken(agent, '/login');

  const loginRes = await agent.post('/login').type('form').send({
    _csrf: initialCsrf,
    email,
    password,
  });

  if (loginRes.status !== 302) {
    throw new Error(`Expected 302 on login, got ${loginRes.status}`);
  }

  const csrfToken = await fetchCsrfToken(agent, '/dashboard');
  return {
    agent,
    csrfToken,
  };
}

module.exports = {
  createTestContext,
  extractCsrfToken,
  fetchCsrfToken,
  signupAndLogin,
  loginAgent,
};
