'use strict';
// Runs in an isolated, temporary Railway service inside ONE school's project.
// Database credentials never leave the project. No Railway/Cloudflare account
// management credentials are accepted by this process.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { archiveKey, encryptFile, decryptFile, signManifest, verifyManifest } = require('./format.cjs');
const { store } = require('./store.cjs');

const ident = value => '"' + String(value).replace(/"/g,'""') + '"';
function command(bin, args, env = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(bin,args,{ env:{ ...process.env, ...env }, stdio:['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data',c => { if (stdout.length < 4096) stdout += c; });
    child.stderr.on('data',c => { if (stderr.length < 4096) stderr += c; });
    child.on('error',()=>reject(new Error(`${bin} unavailable`)));
    child.on('close',code=> code===0 ? resolve(stdout) : reject(new Error(`${bin} failed (exit ${code})`)));
    // Do not log tool stderr: PostgreSQL errors can contain student data or URLs.
  });
}
function pgEnv(url, extra = {}) {
  const parsed = new URL(url);
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw new Error('Invalid PostgreSQL URL');
  return { PGHOST:parsed.hostname, PGPORT:parsed.port || '5432',
    PGUSER:decodeURIComponent(parsed.username), PGPASSWORD:decodeURIComponent(parsed.password),
    PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE:parsed.hostname.endsWith('.railway.internal') || ['localhost','127.0.0.1'].includes(parsed.hostname) ? 'prefer':'require',
    PGOPTIONS:'-c default_transaction_read_only=off', ...extra };
}
async function connect(url) {
  const e = pgEnv(url);
  const client = new Client({ host:e.PGHOST, port:Number(e.PGPORT), user:e.PGUSER, password:e.PGPASSWORD,
    database:e.PGDATABASE, connectionTimeoutMillis:15000, options:'-c default_transaction_read_only=off',
    ssl:e.PGSSLMODE==='require' ? { rejectUnauthorized:false }:false });
  await client.connect(); return client;
}
async function tableCounts(client) {
  const { rows } = await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname <> 'information_schema'
      AND n.nspname NOT LIKE 'pg_%' ORDER BY n.nspname,c.relname`);
  const counts = [];
  for (const row of rows) {
    const result = await client.query(`SELECT count(*)::text AS count FROM ${ident(row.schema)}.${ident(row.name)}`);
    counts.push({ ...row, count:result.rows[0].count });
  }
  // Source and disposable databases may use different default collations.
  // Compare the same deterministic table order, not locale-dependent SQL order.
  return counts.sort((a,b) => {
    const left=a.schema+'\0'+a.name,right=b.schema+'\0'+b.name;
    return left<right?-1:left>right?1:0;
  });
}
async function isolatedDatabase(work, run) {
  const data = path.join(work,'verify-pg');
  await command('initdb',['-D',data,'-U','archive','--auth=trust','--no-locale','--encoding=UTF8']);
  let started = false;
  try {
    await command('pg_ctl',['-D',data,'-l',path.join(work,'verify.log'),'-o',`-h 127.0.0.1 -p 15432 -k ${work}`,'-w','start']);
    started = true;
    const url = 'postgresql://archive@127.0.0.1:15432/postgres';
    return await run(url);
  } finally {
    if (started) await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']).catch(()=>{});
  }
}
function storageEnv(env, prefix) {
  return { endpoint:env[`${prefix}_ENDPOINT`], bucket:env[`${prefix}_BUCKET`],
    accessKeyId:env[`${prefix}_ACCESS_KEY_ID`], secretAccessKey:env[`${prefix}_SECRET_ACCESS_KEY`] };
}
function settings(env) {
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(env.ARCHIVE_SLUG || '')) throw new Error('Invalid school slug');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(env.ARCHIVE_JOB_ID || '') ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(env.ARCHIVE_PREFIX || '')) throw new Error('Invalid archive job');
  if (!['backup','restore','unfreeze'].includes(env.ARCHIVE_MODE)) throw new Error('Invalid archive mode');
  const allowedOrigin = new URL(env.ARCHIVE_CALLBACK_ORIGIN || 'https://pssms.app');
  if (allowedOrigin.protocol !== 'https:' || allowedOrigin.username || allowedOrigin.password || allowedOrigin.port ||
      allowedOrigin.pathname !== '/' || allowedOrigin.search || allowedOrigin.hash) throw new Error('Invalid callback origin');
  const callback = new URL(env.ARCHIVE_CALLBACK_URL);
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.origin !== allowedOrigin.origin || callback.pathname !== `/api/service-jobs/${env.ARCHIVE_JOB_ID}/report` || callback.search || callback.hash) {
    throw new Error('Invalid callback destination');
  }
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(env.ARCHIVE_JOB_TOKEN || '')) throw new Error('Invalid callback token');
  const key = archiveKey(env.ARCHIVE_KEY_BASE64);
  return { slug:env.ARCHIVE_SLUG, jobId:env.ARCHIVE_JOB_ID, prefix:env.ARCHIVE_PREFIX,
    mode:env.ARCHIVE_MODE, key, callback:callback.href, token:env.ARCHIVE_JOB_TOKEN };
}
async function run(env = process.env, dependencies = {}) {
  const s = settings(env);
  const fetchImpl = dependencies.fetch || fetch;
  const archive = dependencies.archive || store(storageEnv(env,'ARCHIVE'),fetchImpl);
  const work = await fs.mkdtemp(path.join(os.tmpdir(),'pssms-archive-'));
  await fs.chmod(work,0o700);
  let sequence = 0;
  async function report(status, step, detail = {}) {
    const body = JSON.stringify({ status,step,sequence:++sequence,...detail });
    for (let attempt=0;attempt<5;attempt++) {
      try {
        const response = await fetchImpl(s.callback,{ method:'POST',headers:{ Authorization:`Bearer ${s.token}`,'Content-Type':'application/json' },
          body,signal:AbortSignal.timeout(30000) });
        if (response.ok) { await response.body?.cancel(); return; }
        await response.body?.cancel();
        if (response.status >= 400 && response.status < 500) throw new Error('Archive callback rejected');
      } catch (err) { if (attempt===4) throw new Error('Archive callback unavailable'); }
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
    throw new Error('Archive callback unavailable');
  }
  let counter = 0;
  const temp = suffix => path.join(work,`${++counter}-${suffix}`);
  async function save(source, objectKey) {
    const encrypted = temp('encrypted');
    const entry = { key:objectKey,...await encryptFile(source,encrypted,s.key,s.slug,objectKey) };
    try { await archive.put(objectKey,encrypted); } finally { await fs.rm(encrypted,{force:true}); }
    return entry;
  }
  async function retrieve(entry) {
    const encrypted = temp('download'), plain = temp('plain');
    try { await archive.get(entry.key,encrypted); await decryptFile(encrypted,plain,s.key,s.slug,entry.key,entry); }
    finally { await fs.rm(encrypted,{force:true}); }
    return plain;
  }
  async function assertFrozen() {
    const schoolUrl = `https://${s.slug}.pssms.app`;
    if (env.ARCHIVE_SCHOOL_URL && env.ARCHIVE_SCHOOL_URL !== schoolUrl) throw new Error('School URL mismatch');
    const response = await fetchImpl(schoolUrl+'/api/service-status',{ redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store' });
    if (!response.ok) throw new Error('School maintenance status unavailable');
    const state = await response.json();
    if (state.readonly !== true || state.freezeId !== s.jobId) throw new Error('School has not confirmed this archive freeze');
    return state;
  }
  try {
    if (s.mode === 'unfreeze') {
      const client = await connect(env.DATABASE_URL);
      try { const db = await client.query('SELECT current_database() AS name');
        await client.query(`ALTER DATABASE ${ident(db.rows[0].name)} RESET default_transaction_read_only`);
        await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()');
      } finally { await client.end(); }
      await report('restored','unfrozen'); return;
    }
    if (s.mode === 'backup') {
      const state = await assertFrozen();
      await report('running','freeze');
      const source = await connect(env.DATABASE_URL);
      const dump = temp('database.dump'); let counts;
      try {
        const db = await source.query('SELECT current_database() AS name');
        // Freeze new connections at the database too, then drain old writers.
        // Only this isolated maintenance connection overrides the default.
        await source.query(`ALTER DATABASE ${ident(db.rows[0].name)} SET default_transaction_read_only=on`);
        await source.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()');
        await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const snapshot = await source.query('SELECT pg_export_snapshot() AS snapshot');
        counts = await tableCounts(source);
        if (!counts.some(t=>t.schema==='public' && t.name==='users')) throw new Error('Source is not a school database');
        await report('running','database');
        await command('pg_dump',['--format=custom','--no-owner','--no-privileges','--snapshot',snapshot.rows[0].snapshot,'--file',dump],pgEnv(env.DATABASE_URL));
        await source.query('COMMIT');
      } finally { await source.end(); }
      const database = await save(dump,s.prefix+'/database.dump.enc');
      const configFile = temp('config');
      const savedEnv = Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('SNAPSHOT_')).map(([k,v])=>[k.slice(9),v]));
      await fs.writeFile(configFile,JSON.stringify({ version:1,slug:s.slug,app_version:state.version,table_counts:counts,environment:savedEnv }),{mode:0o600});
      const config = await save(configFile,s.prefix+'/config.json.enc');
      await fs.rm(configFile,{force:true}); await fs.rm(dump,{force:true});
      await report('running','files');
      if (!env.SOURCE_S3_BUCKET) throw new Error('Source media storage is not configured');
      const media = dependencies.source || store(storageEnv(env,'SOURCE_S3'),fetchImpl);
      if (env.SOURCE_S3_BUCKET === env.ARCHIVE_BUCKET) throw new Error('Live and archive buckets must be separate');
      const originals = await media.list();
      const files = [];
      for (const [index,item] of originals.entries()) {
        const local = temp('media');
        await media.get(item.key,local,item.etag ? { 'If-Match':item.etag }:{});
        if ((await fs.stat(local)).size !== item.size) throw new Error('Media size changed during backup');
        files.push({ source_key:item.key,...await save(local,`${s.prefix}/files/${String(index).padStart(8,'0')}.enc`) });
        await fs.rm(local,{force:true});
        if (index % 20 === 0) await report('running','files');
      }
      if (JSON.stringify(await media.list()) !== JSON.stringify(originals)) throw new Error('Source media changed during backup');
      await report('running','verify');
      for (const item of files) { const local=await retrieve(item); await fs.rm(local,{force:true}); }
      const downloadedDump = await retrieve(database);
      const downloadedConfig = await retrieve(config);
      const saved = JSON.parse(await fs.readFile(downloadedConfig,'utf8'));
      await report('running','restore-test');
      await isolatedDatabase(work,async url=> {
        await command('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname','postgres',downloadedDump],pgEnv(url));
        const restored = await connect(url);
        try { if (JSON.stringify(await tableCounts(restored)) !== JSON.stringify(saved.table_counts)) throw new Error('Restore verification counts differ'); }
        finally { await restored.end(); }
      });
      await assertFrozen();
      const verified_at = new Date().toISOString();
      const manifest = signManifest({ version:1,slug:s.slug,job_id:s.jobId,prefix:s.prefix,freeze_id:s.jobId,
        created_at:verified_at,verified_at,app_version:state.version,database,config,files,
        total_bytes:[database,config,...files].reduce((n,f)=>n+f.bytes,0),files_count:files.length,restore_verified:true },s.key);
      const manifest_key = s.prefix+'/manifest.json';
      await archive.putJson(manifest_key,manifest);
      verifyManifest(await archive.json(manifest_key),s.key,s.slug,s.prefix);
      await report('verified','complete',{ manifest_key,bytes:manifest.total_bytes,db_sha256:database.sha256,files_count:files.length,verified_at });
      return manifest;
    }
    await report('running','restore-start');
    const manifest = verifyManifest(await archive.json(s.prefix+'/manifest.json'),s.key,s.slug,s.prefix);
    const configPath = await retrieve(manifest.config);
    const saved = JSON.parse(await fs.readFile(configPath,'utf8'));
    const destination = await connect(env.DATABASE_URL);
    try { if ((await tableCounts(destination)).length) throw new Error('Restore destination database must be empty'); }
    finally { await destination.end(); }
    const dump = await retrieve(manifest.database);
    await report('running','restore-database');
    await command('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname',pgEnv(env.DATABASE_URL).PGDATABASE,dump],pgEnv(env.DATABASE_URL));
    const restored = await connect(env.DATABASE_URL);
    try { if (JSON.stringify(await tableCounts(restored)) !== JSON.stringify(saved.table_counts)) throw new Error('Restored database counts differ'); }
    finally { await restored.end(); }
    await report('running','restore-files');
    const destinationMedia = dependencies.destination || store(storageEnv(env,'DEST_S3'),fetchImpl);
    if (env.DEST_S3_BUCKET === env.ARCHIVE_BUCKET) throw new Error('Cannot restore media into archive bucket');
    if ((await destinationMedia.list()).length) throw new Error('Restore media destination must be empty');
    for (const item of manifest.files) {
      const local = await retrieve(item); await destinationMedia.put(item.source_key,local);
      const checked = temp('restored-media'); await destinationMedia.get(item.source_key,checked);
      const actual = await require('./format.cjs').digestFile(checked);
      if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error('Restored media checksum differs');
      await fs.rm(local,{force:true}); await fs.rm(checked,{force:true});
    }
    await report('restored','restore-complete',{ manifest_key:s.prefix+'/manifest.json',bytes:manifest.total_bytes,
      db_sha256:manifest.database.sha256,files_count:manifest.files_count,verified_at:new Date().toISOString() });
  } catch (err) {
    // Report only fixed, sanitized diagnostics; never forward tool output/URLs.
    const allowed = /^(Source |School |Archive |Restore |Restored |Cannot |Invalid |Live |Media |R2 |pg_dump |pg_restore |initdb |pg_ctl )/;
    const message = allowed.test(err.message) ? err.message.slice(0,180) : 'Archive operation failed; inspect the isolated runner';
    await report('failed','failed',{error:message}).catch(()=>{});
    throw new Error(message);
  } finally { await fs.rm(work,{recursive:true,force:true}); }
}
if (require.main === module) run().catch(err=>{ console.error('[school-archive]',err.message); process.exitCode=1; });
module.exports = { run, settings, tableCounts, pgEnv, command };
