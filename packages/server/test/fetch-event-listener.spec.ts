import { CustomEvent } from '@whatwg-node/events';
import { FetchEvent } from '@whatwg-node/server';
import { runTestsForEachFetchImpl } from './test-fetch.js';

class PonyfillFetchEvent extends CustomEvent<{}> implements FetchEvent {
  constructor(
    public request: Request,
    public respondWith: FetchEvent['respondWith'],
    public waitUntil: FetchEvent['waitUntil'],
  ) {
    super('fetch');
  }
}

describe('FetchEvent listener', () => {
  runTestsForEachFetchImpl(
    (_, { createServerAdapter, fetchAPI: { Request, Response } }) => {
      it('should not return a promise to event listener', async () => {
        const response = new Response();
        const response$ = Promise.resolve(response);
        const adapter = createServerAdapter(() => response$);
        const respondWith = jest.fn();
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        const returnValue = adapter(fetchEvent);
        expect(returnValue).toBeUndefined();
        const returnedResponse = await respondWith.mock.calls[0][0];
        expect(returnedResponse).toBe(response);
      });
      it('should expose FetchEvent as server context', async () => {
        const handleRequest = jest.fn();
        const adapter = createServerAdapter(handleRequest);
        const respondWith = jest.fn();
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        adapter(fetchEvent);
        expect(handleRequest).toHaveBeenCalledWith(fetchEvent.request, fetchEvent);
      });
      it('should accept additional parameters as server context', async () => {
        const handleRequest = jest.fn();
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const respondWith = jest.fn();
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        const additionalCtx = { foo: 'bar' };
        adapter(fetchEvent, additionalCtx);
        expect(handleRequest).toHaveBeenCalledWith(
          fetchEvent.request,
          expect.objectContaining(additionalCtx),
        );
      });
    },
    { noLibCurl: true },
  );
});
