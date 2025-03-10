import { createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { PonyfillBlob } from './Blob.js';
import { fetchCurl } from './fetchCurl.js';
import { fetchNodeHttp } from './fetchNodeHttp.js';
import { PonyfillRequest, RequestPonyfillInit } from './Request.js';
import { PonyfillResponse } from './Response.js';

const BASE64_SUFFIX = ';base64';

function getResponseForFile(url: string) {
  const path = fileURLToPath(url);
  const readable = createReadStream(path);
  return new PonyfillResponse(readable);
}

function getResponseForDataUri(url: string) {
  const [mimeType = 'text/plain', ...datas] = url.substring(5).split(',');
  const data = decodeURIComponent(datas.join(','));
  if (mimeType.endsWith(BASE64_SUFFIX)) {
    const buffer = Buffer.from(data, 'base64url');
    const realMimeType = mimeType.slice(0, -BASE64_SUFFIX.length);
    const file = new PonyfillBlob([buffer], { type: realMimeType });
    return new PonyfillResponse(file, {
      status: 200,
      statusText: 'OK',
    });
  }
  return new PonyfillResponse(data, {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': mimeType,
    },
  });
}

export async function fetchPonyfill<TResponseJSON = any, TRequestJSON = any>(
  info: string | PonyfillRequest<TRequestJSON> | URL,
  init?: RequestPonyfillInit,
): Promise<PonyfillResponse<TResponseJSON>> {
  if (typeof info === 'string' || 'href' in info) {
    const ponyfillRequest = new PonyfillRequest(info, init);
    return fetchPonyfill(ponyfillRequest);
  }
  const fetchRequest = info;
  if (fetchRequest.url.startsWith('data:')) {
    const response = getResponseForDataUri(fetchRequest.url);
    return Promise.resolve(response);
  }

  if (fetchRequest.url.startsWith('file:')) {
    const response = getResponseForFile(fetchRequest.url);
    return Promise.resolve(response);
  }
  if (globalThis.libcurl) {
    return fetchCurl(fetchRequest);
  }
  return fetchNodeHttp(fetchRequest);
}
