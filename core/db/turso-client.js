/**
 * turso-client.js
 * ---------------------------------------------------------------
 * Low-level Turso HTTP (libSQL) client. Runs SERVER-SIDE ONLY — the
 * TURSO_URL / TURSO_TOKEN env vars this reads must never reach the browser.
 * core/auth/session.js gates every call into here behind a valid session.
 * ---------------------------------------------------------------
 */

async function tursoQuery(url, token, sql, args = []) {
  const httpUrl = url.replace('libsql://', 'https://').replace('wss://', 'https://');
  try {
    const resp = await fetch(`${httpUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            type: 'execute',
            stmt: {
              sql,
              args: args.map(a => ({
                type: typeof a === 'number' ? 'integer' : 'text',
                value: String(a ?? ''),
              })),
            },
          },
          { type: 'close' },
        ],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || 'Turso request failed');
    const result = data.results?.[0];
    if (result?.type === 'error') throw new Error(result.error?.message || 'Query error');
    return { data: result?.response?.result, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

async function tursoExec(client, sql, args = []) {
  const { error } = await tursoQuery(client.url, client.token, sql, args);
  if (error) throw new Error(error);
}

async function tursoSelect(client, sql, args = []) {
  const { data, error } = await tursoQuery(client.url, client.token, sql, args);
  if (error) throw new Error(error);
  const cols = data?.cols?.map(c => c.name) || [];
  return (data?.rows || []).map(row => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i]?.value ?? null; });
    return obj;
  });
}

function getClient() {
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
  if (!url || !token) throw new Error('TURSO_URL / TURSO_TOKEN not set');
  return { url, token };
}

export { tursoQuery, tursoExec, tursoSelect, getClient };
