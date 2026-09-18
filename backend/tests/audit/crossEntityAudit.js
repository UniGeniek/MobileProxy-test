// Cross-entity invariant audit for DataCenter
// Usage: node crossEntityAudit.js
// Requires database accessible via src/db config

const db = require('../../src/db');

async function runAudit(limit = 1000) {
  // Collect recent reset_jobs to audit
  const jobsRes = await db.query(
    `SELECT id, reset_log_id, proxy_id, state, created_at, updated_at, attempts FROM reset_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );

  const anomalies = [];
  const summary = { total: jobsRes.rows.length, byState: {} };

  for (const job of jobsRes.rows) {
    summary.byState[job.state] = (summary.byState[job.state] || 0) + 1;

    // Fetch related proxy and reset_log
    const proxyRes = await db.query('SELECT id, port, status, current_ip, is_active, updated_at FROM proxies WHERE id=$1', [job.proxy_id]);
    const logRes = await db.query('SELECT id, status, created_at, finished_at FROM reset_logs WHERE id=$1', [job.reset_log_id]);

    const proxy = proxyRes.rows[0] || null;
    const rlog = logRes.rows[0] || null;

    // Invariant 1: success -> proxy should not remain 'resetting'
    if (job.state === 'success') {
      if (proxy && proxy.status === 'resetting') {
        anomalies.push({ id: job.id, type: 'proxy_drift_after_success', detail: { jobState: job.state, proxyStatus: proxy.status } });
      }
      if (rlog && !['success','ip_unchanged'].includes(rlog.status)) {
        anomalies.push({ id: job.id, type: 'log_mismatch_for_success', detail: { logStatus: rlog.status } });
      }
    }

    // Invariant 2: failed/dead_letter -> proxy must not remain resetting
    if (['failed','dead_letter'].includes(job.state)) {
      if (proxy && proxy.status === 'resetting') {
        anomalies.push({ id: job.id, type: 'proxy_drift_after_failure', detail: { jobState: job.state, proxyStatus: proxy.status } });
      }
    }

    // Invariant 3: temporal alignment
    if (rlog && job.created_at && rlog.created_at && new Date(rlog.created_at) > new Date(job.created_at)) {
      anomalies.push({ id: job.id, type: 'log_created_after_job', detail: { jobCreated: job.created_at, logCreated: rlog.created_at } });
    }
    if (rlog && rlog.finished_at && job.updated_at && new Date(rlog.finished_at) > new Date(job.updated_at)) {
      anomalies.push({ id: job.id, type: 'log_finished_after_job_update', detail: { jobUpdated: job.updated_at, logFinished: rlog.finished_at } });
    }

    // Invariant 4: reset_logs status vs job final state
    if (job.state === 'success' && rlog && rlog.status === 'failed') {
      anomalies.push({ id: job.id, type: 'log_failed_but_job_success', detail: { logStatus: rlog.status } });
    }

    // Invariant 5: ensure job not stuck in pending while proxy not resetting
    if (job.state === 'pending' && proxy && proxy.status === 'resetting') {
      anomalies.push({ id: job.id, type: 'pending_but_proxy_resetting', detail: { jobState: job.state, proxyStatus: proxy.status } });
    }

    // Invariant 6: running duplicates check (quick sample via history not stored here) - skip (requires log history)
  }

  return { summary, anomalies };
}

async function main() {
  try {
    console.log('Running cross-entity audit (recent reset_jobs)');
    const res = await runAudit(1000);
    console.log('Summary:', res.summary);
    if (res.anomalies.length) {
      console.log('Anomalies found:', res.anomalies.slice(0, 200));
      console.log(`Total anomalies: ${res.anomalies.length}`);
      process.exit(2);
    }
    console.log('No anomalies detected (within sample)');
    process.exit(0);
  } catch (err) {
    console.error('Audit failed', err);
    process.exit(1);
  }
}

main();
