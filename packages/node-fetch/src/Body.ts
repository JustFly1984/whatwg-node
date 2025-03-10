import { Readable } from 'stream';
import busboy from 'busboy';
import { PonyfillBlob } from './Blob.js';
import { PonyfillFile } from './File.js';
import { getStreamFromFormData, PonyfillFormData } from './FormData.js';
import { PonyfillReadableStream } from './ReadableStream.js';
import { uint8ArrayToArrayBuffer } from './utils.js';

enum BodyInitType {
  ReadableStream = 'ReadableStream',
  Blob = 'Blob',
  FormData = 'FormData',
  ArrayBuffer = 'ArrayBuffer',
  String = 'String',
  Readable = 'Readable',
  Buffer = 'Buffer',
  Uint8Array = 'Uint8Array',
}

export type BodyPonyfillInit =
  | XMLHttpRequestBodyInit
  | Readable
  | PonyfillReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface FormDataLimits {
  /* Max field name size (in bytes). Default: 100. */
  fieldNameSize?: number;
  /* Max field value size (in bytes). Default: 1MB. */
  fieldSize?: number;
  /* Max number of fields. Default: Infinity. */
  fields?: number;
  /* For multipart forms, the max file size (in bytes). Default: Infinity. */
  fileSize?: number;
  /* For multipart forms, the max number of file fields. Default: Infinity. */
  files?: number;
  /* For multipart forms, the max number of parts (fields + files). Default: Infinity. */
  parts?: number;
  /* For multipart forms, the max number of header key-value pairs to parse. Default: 2000. */
  headerSize?: number;
}

export interface PonyfillBodyOptions {
  formDataLimits?: FormDataLimits;
}

export class PonyfillBody<TJSON = any> implements Body {
  bodyUsed = false;
  contentType: string | null = null;
  contentLength: number | null = null;

  constructor(
    private bodyInit: BodyPonyfillInit | null,
    private options: PonyfillBodyOptions = {},
  ) {
    const { bodyFactory, contentType, contentLength, bodyType } = processBodyInit(bodyInit);
    this._bodyFactory = bodyFactory;
    this.contentType = contentType;
    this.contentLength = contentLength;
    this.bodyType = bodyType;
  }

  private bodyType?: BodyInitType;

  private _bodyFactory: () => PonyfillReadableStream<Uint8Array> | null = () => null;
  private _generatedBody: PonyfillReadableStream<Uint8Array> | null = null;

  private generateBody(): PonyfillReadableStream<Uint8Array> | null {
    if (this._generatedBody) {
      return this._generatedBody;
    }
    const body = this._bodyFactory();
    this._generatedBody = body;
    return body;
  }

  public get body(): PonyfillReadableStream<Uint8Array> | null {
    const _body = this.generateBody();
    if (_body != null) {
      const ponyfillReadableStream = _body;
      const readable = _body.readable;
      return new Proxy(_body.readable as any, {
        get(_, prop) {
          if (prop in ponyfillReadableStream) {
            const ponyfillReadableStreamProp: any = (ponyfillReadableStream as any)[prop];
            if (typeof ponyfillReadableStreamProp === 'function') {
              return ponyfillReadableStreamProp.bind(ponyfillReadableStream);
            }
            return ponyfillReadableStreamProp;
          }
          if (prop in readable) {
            const readableProp: any = (readable as any)[prop];
            if (typeof readableProp === 'function') {
              return readableProp.bind(readable);
            }
            return readableProp;
          }
        },
      });
    }
    return null;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.bodyType === BodyInitType.ArrayBuffer) {
      return this.bodyInit as ArrayBuffer;
    }
    if (this.bodyType === BodyInitType.Uint8Array || this.bodyType === BodyInitType.Buffer) {
      const typedBodyInit = this.bodyInit as Uint8Array;
      return uint8ArrayToArrayBuffer(typedBodyInit);
    }
    if (this.bodyType === BodyInitType.String) {
      const buffer = Buffer.from(this.bodyInit as string);
      return uint8ArrayToArrayBuffer(buffer);
    }
    if (this.bodyType === BodyInitType.Blob) {
      const blob = this.bodyInit as PonyfillBlob;
      const arrayBuffer = await blob.arrayBuffer();
      return arrayBuffer;
    }
    const blob = await this.blob();
    return blob.arrayBuffer();
  }

  _collectChunksFromReadable() {
    return new Promise<Uint8Array[]>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const _body = this.generateBody();
      if (_body) {
        _body.readable.on('data', chunk => {
          chunks.push(chunk);
        });
        _body.readable.on('end', () => {
          resolve(chunks);
        });
        _body.readable.on('error', e => {
          reject(e);
        });
      } else {
        resolve(chunks);
      }
    });
  }

  async blob(): Promise<PonyfillBlob> {
    if (this.bodyType === BodyInitType.Blob) {
      return this.bodyInit as PonyfillBlob;
    }
    if (
      this.bodyType === BodyInitType.String ||
      this.bodyType === BodyInitType.Buffer ||
      this.bodyType === BodyInitType.Uint8Array
    ) {
      const bodyInitTyped = this.bodyInit as string | Buffer | Uint8Array;
      return new PonyfillBlob([bodyInitTyped], {
        type: this.contentType || '',
      });
    }
    if (this.bodyType === BodyInitType.ArrayBuffer) {
      const bodyInitTyped = this.bodyInit as ArrayBuffer;
      const buf = Buffer.from(bodyInitTyped, undefined, bodyInitTyped.byteLength);
      return new PonyfillBlob([buf], {
        type: this.contentType || '',
      });
    }
    const chunks = await this._collectChunksFromReadable();
    return new PonyfillBlob(chunks, {
      type: this.contentType || '',
    });
  }

  formData(opts?: { formDataLimits: FormDataLimits }): Promise<PonyfillFormData> {
    if (this.bodyType === BodyInitType.FormData) {
      return Promise.resolve(this.bodyInit as PonyfillFormData);
    }
    const formData = new PonyfillFormData();
    const _body = this.generateBody();
    if (_body == null) {
      return Promise.resolve(formData);
    }
    const formDataLimits = {
      ...this.options.formDataLimits,
      ...opts?.formDataLimits,
    };
    return new Promise((resolve, reject) => {
      const bb = busboy({
        headers: {
          'content-type': this.contentType || '',
        },
        limits: formDataLimits,
        defParamCharset: 'utf-8',
      });
      bb.on('field', (name, value, { nameTruncated, valueTruncated }) => {
        if (nameTruncated) {
          reject(new Error(`Field name size exceeded: ${formDataLimits?.fieldNameSize} bytes`));
        }
        if (valueTruncated) {
          reject(new Error(`Field value size exceeded: ${formDataLimits?.fieldSize} bytes`));
        }
        formData.set(name, value);
      });
      bb.on('fieldsLimit', () => {
        reject(new Error(`Fields limit exceeded: ${formDataLimits?.fields}`));
      });
      bb.on(
        'file',
        (name, fileStream: Readable & { truncated: boolean }, { filename, mimeType }) => {
          const chunks: BlobPart[] = [];
          fileStream.on('limit', () => {
            reject(new Error(`File size limit exceeded: ${formDataLimits?.fileSize} bytes`));
          });
          fileStream.on('data', chunk => {
            chunks.push(Buffer.from(chunk));
          });
          fileStream.on('close', () => {
            if (fileStream.truncated) {
              reject(new Error(`File size limit exceeded: ${formDataLimits?.fileSize} bytes`));
            }
            const file = new PonyfillFile(chunks, filename, { type: mimeType });
            formData.set(name, file);
          });
        },
      );
      bb.on('filesLimit', () => {
        reject(new Error(`Files limit exceeded: ${formDataLimits?.files}`));
      });
      bb.on('partsLimit', () => {
        reject(new Error(`Parts limit exceeded: ${formDataLimits?.parts}`));
      });
      bb.on('close', () => {
        resolve(formData);
      });
      bb.on('error', err => {
        reject(err);
      });
      _body?.readable.pipe(bb);
    });
  }

  async buffer(): Promise<Buffer> {
    if (this.bodyType === BodyInitType.Buffer) {
      return this.bodyInit as Buffer;
    }
    if (this.bodyType === BodyInitType.String) {
      return Buffer.from(this.bodyInit as string);
    }
    if (this.bodyType === BodyInitType.Uint8Array || this.bodyType === BodyInitType.ArrayBuffer) {
      const bodyInitTyped = this.bodyInit as Uint8Array | ArrayBuffer;
      const buffer = Buffer.from(
        bodyInitTyped,
        'byteOffset' in bodyInitTyped ? bodyInitTyped.byteOffset : undefined,
        bodyInitTyped.byteLength,
      );
      return buffer;
    }
    if (this.bodyType === BodyInitType.Blob) {
      if (this.bodyInit instanceof PonyfillBlob) {
        return this.bodyInit.buffer();
      }
      const bodyInitTyped = this.bodyInit as Blob;
      const buffer = Buffer.from(await bodyInitTyped.arrayBuffer(), undefined, bodyInitTyped.size);
      return buffer;
    }
    const chunks = await this._collectChunksFromReadable();
    return Buffer.concat(chunks);
  }

  async json(): Promise<TJSON> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async text(): Promise<string> {
    if (this.bodyType === BodyInitType.String) {
      return this.bodyInit as string;
    }
    const buffer = await this.buffer();
    return buffer.toString('utf-8');
  }
}

function processBodyInit(bodyInit: BodyPonyfillInit | null): {
  bodyType?: BodyInitType;
  contentType: string | null;
  contentLength: number | null;
  bodyFactory(): PonyfillReadableStream<Uint8Array> | null;
} {
  if (bodyInit == null) {
    return {
      bodyFactory: () => null,
      contentType: null,
      contentLength: null,
    };
  }
  if (typeof bodyInit === 'string') {
    const buffer = Buffer.from(bodyInit);
    const contentLength = buffer.byteLength;
    return {
      bodyType: BodyInitType.String,
      contentType: 'text/plain;charset=UTF-8',
      contentLength,
      bodyFactory() {
        const readable = Readable.from(buffer);
        return new PonyfillReadableStream<Uint8Array>(readable);
      },
    };
  }
  if (bodyInit instanceof Buffer) {
    const contentLength = bodyInit.byteLength;
    return {
      bodyType: BodyInitType.Buffer,
      contentLength,
      contentType: null,
      bodyFactory() {
        const readable = Readable.from(bodyInit);
        const body = new PonyfillReadableStream<Uint8Array>(readable);
        return body;
      },
    };
  }
  if (bodyInit instanceof PonyfillReadableStream) {
    return {
      bodyType: BodyInitType.ReadableStream,
      bodyFactory: () => bodyInit,
      contentType: null,
      contentLength: null,
    };
  }
  if (bodyInit instanceof PonyfillBlob) {
    return {
      bodyType: BodyInitType.Blob,
      contentType: bodyInit.type,
      contentLength: bodyInit.size,
      bodyFactory() {
        return bodyInit.stream();
      },
    };
  }
  if (bodyInit instanceof Uint8Array) {
    const contentLength = bodyInit.byteLength;
    return {
      bodyType: BodyInitType.Uint8Array,
      contentLength,
      contentType: null,
      bodyFactory() {
        const readable = Readable.from(bodyInit);
        const body = new PonyfillReadableStream<Uint8Array>(readable);
        return body;
      },
    };
  }
  if ('buffer' in bodyInit) {
    const contentLength = bodyInit.byteLength;
    return {
      contentLength,
      contentType: null,
      bodyFactory() {
        const buffer = Buffer.from(bodyInit as Buffer);
        const readable = Readable.from(buffer);
        const body = new PonyfillReadableStream<Uint8Array>(readable);
        return body;
      },
    };
  }
  if (bodyInit instanceof ArrayBuffer) {
    const contentLength = bodyInit.byteLength;
    return {
      bodyType: BodyInitType.ArrayBuffer,
      contentType: null,
      contentLength,
      bodyFactory() {
        const buffer = Buffer.from(bodyInit, undefined, bodyInit.byteLength);
        const readable = Readable.from(buffer);
        const body = new PonyfillReadableStream<Uint8Array>(readable);
        return body;
      },
    };
  }
  if (bodyInit instanceof Readable) {
    return {
      bodyType: BodyInitType.Readable,
      contentType: null,
      contentLength: null,
      bodyFactory() {
        const body = new PonyfillReadableStream<Uint8Array>(bodyInit);
        return body;
      },
    };
  }
  if ('stream' in bodyInit) {
    return {
      contentType: bodyInit.type,
      contentLength: bodyInit.size,
      bodyFactory() {
        const bodyStream = bodyInit.stream();
        const body = new PonyfillReadableStream<Uint8Array>(bodyStream);
        return body;
      },
    };
  }
  if ('sort' in bodyInit) {
    const contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
    return {
      bodyType: BodyInitType.String,
      contentType,
      contentLength: null,
      bodyFactory() {
        const body = new PonyfillReadableStream<Uint8Array>(Readable.from(bodyInit.toString()));
        return body;
      },
    };
  }
  if ('forEach' in bodyInit) {
    const boundary = Math.random().toString(36).substr(2);
    const contentType = `multipart/form-data; boundary=${boundary}`;
    return {
      contentType,
      contentLength: null,
      bodyFactory() {
        return getStreamFromFormData(bodyInit, boundary);
      },
    };
  }

  if ((bodyInit as any)[Symbol.iterator] || (bodyInit as any)[Symbol.asyncIterator]) {
    return {
      contentType: null,
      contentLength: null,
      bodyFactory() {
        const readable = Readable.from(bodyInit);
        return new PonyfillReadableStream(readable);
      },
    };
  }

  throw new Error('Unknown body type');
}
