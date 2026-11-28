import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPapersCommand, rebuildInvertedAbstract } from '../src/ideas/papers-search.mjs';

const openAlexBody = {
  results: [{
    id: 'https://openalex.org/W1',
    doi: 'https://doi.org/10.1000/xyz',
    display_name: 'Active Retrieval Augmented Generation',
    publication_year: 2023,
    authorships: [{ author: { display_name: 'Ana Ruiz' } }, { author: { display_name: 'Bo Li' } }],
    primary_location: { source: { display_name: 'EMNLP' } },
    cited_by_count: 42,
    abstract_inverted_index: { Retrieval: [0], helps: [1], models: [2] },
  }],
};

const semanticScholarBody = {
  data: [{ title: 'Dense Passage Retrieval', year: 2020, authors: [{ name: 'V. Karpukhin' }], venue: 'EMNLP', externalIds: { DOI: '10.18653/v1/x' }, url: 'https://www.semanticscholar.org/paper/abc', citationCount: 3000, abstract: 'Open-domain question answering.' }],
};

function recordingFetch(responseBody, requestedUrls) {
  return async (requestUrl, requestHeaders) => {
    requestedUrls.push({ requestUrl, requestHeaders });
    return responseBody;
  };
}

test('papers: OpenAlex by default, every field printed, --limit and --json [brainstorm-mode:S1]', async () => {
  const requestedUrls = [];
  const textResult = await runPapersCommand(['search', 'retrieval', 'augmented'], { fetchJson: recordingFetch(openAlexBody, requestedUrls), environment: {} });
  assert.equal(textResult.exitCode, 0);
  assert.match(requestedUrls[0].requestUrl, /^https:\/\/api\.openalex\.org\/works\?search=retrieval\+augmented&per-page=10/);
  assert.doesNotMatch(requestedUrls[0].requestUrl, /api_key/);
  assert.match(textResult.output, /OpenAlex: 1 paper\(s\) for "retrieval augmented"/);
  assert.match(textResult.output, /1\. Active Retrieval Augmented Generation \(2023\)/);
  assert.match(textResult.output, /Ana Ruiz, Bo Li \| EMNLP \| 42 citations/);
  assert.match(textResult.output, /https:\/\/doi\.org\/10\.1000\/xyz/);
  assert.match(textResult.output, /Retrieval helps models/);

  const jsonResult = await runPapersCommand(['search', 'rag', '--limit', '3', '--json'], { fetchJson: recordingFetch(openAlexBody, requestedUrls), environment: { OPENALEX_API_KEY: 'k1' } });
  assert.match(requestedUrls[1].requestUrl, /per-page=3/);
  assert.match(requestedUrls[1].requestUrl, /api_key=k1/, 'an optional key comes from the environment');
  assert.deepEqual(JSON.parse(jsonResult.output)[0], {
    title: 'Active Retrieval Augmented Generation', year: 2023, authors: ['Ana Ruiz', 'Bo Li'], venue: 'EMNLP',
    doi: '10.1000/xyz', url: 'https://doi.org/10.1000/xyz', citations: 42, abstract: 'Retrieval helps models',
  });
});

test('papers: --source semantic-scholar asks only Semantic Scholar, same fields [brainstorm-mode:S2]', async () => {
  const requestedUrls = [];
  const jsonResult = await runPapersCommand(['search', 'dense retrieval', '--source', 'semantic-scholar', '--json'], { fetchJson: recordingFetch(semanticScholarBody, requestedUrls), environment: { SEMANTIC_SCHOLAR_API_KEY: 'k2' } });
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0].requestUrl, /^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/search\?query=dense\+retrieval&limit=10/);
  assert.deepEqual(requestedUrls[0].requestHeaders, { 'x-api-key': 'k2' });
  assert.deepEqual(JSON.parse(jsonResult.output)[0], {
    title: 'Dense Passage Retrieval', year: 2020, authors: ['V. Karpukhin'], venue: 'EMNLP',
    doi: '10.18653/v1/x', url: 'https://doi.org/10.18653/v1/x', citations: 3000, abstract: 'Open-domain question answering.',
  });
});

test('papers: a failing, rate-limited or silent source exits non-zero with the reason, no stack trace [brainstorm-mode:S3]', async () => {
  const rateLimited = await runPapersCommand(['search', 'rag'], { fetchJson: async () => { throw new Error('HTTP 429, rate limited'); }, environment: {} });
  assert.equal(rateLimited.exitCode, 1);
  assert.equal(rateLimited.output, 'ai1: no source answered - OpenAlex: HTTP 429, rate limited');

  const timeoutError = new Error('aborted');
  timeoutError.name = 'TimeoutError';
  const silent = await runPapersCommand(['search', 'rag', '--source', 'semantic-scholar'], { fetchJson: async () => { throw timeoutError; }, environment: {} });
  assert.equal(silent.output, 'ai1: no source answered - Semantic Scholar: no answer in 15 s');
  assert.doesNotMatch(silent.output, /at .*\.mjs/);
});

test('papers: bad arguments get the usage, never a request', async () => {
  const neverFetch = async () => { throw new Error('should not fetch'); };
  assert.match((await runPapersCommand(['search'], { fetchJson: neverFetch })).output, /^usage: ai1 papers search/);
  assert.match((await runPapersCommand(['search', 'x', '--source', 'arxiv'], { fetchJson: neverFetch })).output, /unknown source "arxiv"/);
  assert.match((await runPapersCommand(['search', 'x', '--limit', '0'], { fetchJson: neverFetch })).output, /--limit must be/);
  assert.equal(rebuildInvertedAbstract(null), null);
});
