'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { AwsClient } = require('aws4fetch');

const escapeXml = value => String(value).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[c]));
const unXml = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi,
  (_, v) => v.startsWith('#x') ? String.fromCodePoint(parseInt(v.slice(2),16))
    : v.startsWith('#') ? String.fromCodePoint(Number(v.slice(1)))
      : ({ lt:'<',gt:'>',amp:'&',quot:'"',apos:"'" }[v]));
const xmlTag = (text, tag) => unXml(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] || '');

function store(config, fetchImpl = fetch) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)) {
    throw new Error('Archive storage must be a Cloudflare R2 HTTPS endpoint');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket || '')) throw new Error('Invalid R2 bucket');
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region:'auto', service:'s3' });
  const url = (key = '', query = {}) => {
    const u = new URL(endpoint.origin + '/' + config.bucket + '/' + key.split('/').map(encodeURIComponent).join('/'));
    for (const [k,v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  };
  async function request(key, init = {}, query = {}) {
    const signed = await client.sign(url(key, query), init);
    const response = await fetchImpl(signed, { redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`R2 request failed (${response.status})`); }
    return response;
  }
  return {
    async list() {
      const objects = []; let token = '';
      do {
        const response = await request('', {}, { 'list-type':'2', 'encoding-type':'url', ...(token ? { 'continuation-token':token } : {}) });
        const body = await response.text();
        for (const match of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          objects.push({ key: decodeURIComponent(xmlTag(match[1],'Key')), size:Number(xmlTag(match[1],'Size')), etag:xmlTag(match[1],'ETag') });
        }
        const next = xmlTag(body,'NextContinuationToken');
        if (xmlTag(body,'IsTruncated') === 'true' && (!next || next === token)) throw new Error('Invalid R2 pagination');
        token = xmlTag(body,'IsTruncated') === 'true' ? next : '';
      } while (token);
      return objects.sort((a,b) => a.key.localeCompare(b.key));
    },
    async get(key, file, headers = {}) {
      const response = await request(key, { headers });
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file, { mode:0o600 }));
    },
    async json(key) {
      const response = await request(key);
      const text = await response.text();
      if (text.length > 16 * 1024 * 1024) throw new Error('Manifest too large');
      return JSON.parse(text);
    },
    async putJson(key, value) {
      const response = await request(key, { method:'PUT', body:JSON.stringify(value),
        headers:{ 'Content-Type':'application/json', 'x-amz-storage-class':'STANDARD', 'If-None-Match':'*' } });
      await response.body?.cancel();
    },
    async put(key, file) {
      const { size } = await fsp.stat(file);
      // Bounded memory, repeatable parts; never retry a consumed file stream.
      const partSize = 16 * 1024 * 1024;
      if (size <= partSize) {
        const response = await request(key, { method:'PUT', body:await fsp.readFile(file),
          headers:{ 'Content-Type':'application/octet-stream', 'x-amz-storage-class':'STANDARD' } });
        await response.body?.cancel(); return;
      }
      const started = await request(key, { method:'POST', headers:{ 'x-amz-storage-class':'STANDARD' } }, { uploads:'' });
      const uploadId = xmlTag(await started.text(),'UploadId');
      if (!uploadId) throw new Error('Missing R2 multipart upload id');
      const handle = await fsp.open(file,'r'); const parts = [];
      try {
        for (let offset = 0, part = 1; offset < size; offset += partSize, part++) {
          const buffer = Buffer.alloc(Math.min(partSize, size-offset));
          const { bytesRead } = await handle.read(buffer,0,buffer.length,offset);
          if (bytesRead !== buffer.length) throw new Error('Archive file changed during upload');
          const response = await request(key, { method:'PUT', body:buffer }, { uploadId, partNumber:String(part) });
          const etag = response.headers.get('etag'); await response.body?.cancel();
          if (!etag) throw new Error('R2 did not return a part checksum');
          parts.push(`<Part><PartNumber>${part}</PartNumber><ETag>${escapeXml(etag)}</ETag></Part>`);
        }
        const response = await request(key, { method:'POST', body:`<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>` }, { uploadId });
        const result = await response.text();
        if (/<Error>/.test(result)) throw new Error('R2 multipart completion failed');
      } catch (err) {
        await request(key, { method:'DELETE' }, { uploadId }).then(r=>r.body?.cancel()).catch(()=>{});
        throw err;
      } finally { await handle.close(); }
    },
  };
}
module.exports = { store, xmlTag };
