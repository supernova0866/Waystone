/**
 * turso-client.js
 * ---------------------------------------------------------------
 * Low-level Turso HTTP (libSQL) client. Runs SERVER-SIDE ONLY — the
 * TURSO_URL / TURSO_TOKEN env vars this reads must never reach the browser.
 * core/auth/session.js gates every call into here behind a valid session.
 * ---------------------------------------------------------------
 */

function toHttpUrl(url) {
  return url.replace('libsql://', 'https://').replace('wss://', 'https://');
}

function encodeArg(a) {
  if (a === null || a === undefined) return { type: 'null' };
  if (typeof a === 'number') {
    return Number.isInteger(a)
      ? { type: 'integer', value: String(a) }
      : { type: 'float', value: a };
  }
  return { type: 'text', value: String(a) };
}

function encodeStmt(sql, args = []) {
  return { sql, args: args.map(encodeArg) };
}

async function tursoQuery(url, token, sql, args = []) {
  try {
    const resp = await fetch(`${toHttpUrl(url)}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          { type: 'execute', stmt: encodeStmt(sql, args) },
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
  const { data, error } = await tursoQuery(client.url, client.token, sql, args);
  if (error) throw new Error(error);
  return data?.affected_row_count ?? 0;
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

// Each statement only runs if the previous step succeeded, and ROLLBACK
// runs only if COMMIT didn't. Returns affected row counts per statement.
async function tursoBatch(client, statements) {
  if (!statements.length) return [];

  const steps = [{ stmt: encodeStmt('BEGIN') }];
  statements.forEach((s, i) => {
    steps.push({ stmt: encodeStmt(s.sql, s.args), condition: { type: 'ok', step: i } });
  });
  const commitIdx = steps.length;
  steps.push({ stmt: encodeStmt('COMMIT'), condition: { type: 'ok', step: commitIdx - 1 } });
  steps.push({
    stmt: encodeStmt('ROLLBACK'),
    condition: { type: 'not', cond: { type: 'ok', step: commitIdx } },
  });

  let data;
  try {
    const resp = await fetch(`${toHttpUrl(client.url)}/v2/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ type: 'batch', batch: { steps } }, { type: 'close' }],
      }),
    });
    data = await resp.json();
    if (!resp.ok) throw new Error(data.message || 'Turso request failed');
  } catch (e) {
    throw new Error(e.message);
  }

  const result = data.results?.[0];
  if (result?.type === 'error') throw new Error(result.error?.message || 'Batch error');

  const { step_results: stepResults = [], step_errors: stepErrors = [] } = result?.response?.result || {};
  const failedAt = stepErrors.findIndex(Boolean);
  if (failedAt !== -1) throw new Error(stepErrors[failedAt].message || 'Batch statement failed');
  if (!stepResults[commitIdx]) throw new Error('Batch was not committed');

  return statements.map((_, i) => stepResults[i + 1]?.affected_row_count ?? 0);
}

function getClient() {
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
  if (!url || !token) throw new Error('TURSO_URL / TURSO_TOKEN not set');
  return { url, token };
}

export { tursoQuery, tursoExec, tursoSelect, tursoBatch, getClient };
