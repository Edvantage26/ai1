// `ai1 papers search`: scientific papers for a brainstorm, with exact citations. The agent's web fetch
// passes pages through a summarizing model, so DOIs and abstracts can come back lost or invented; this
// asks the source's API and prints its fields as they are. OpenAlex by default (no key, every field);
// Semantic Scholar on request. An optional free key per source comes from the environment, never
// from a file: without one both share a small public budget and may answer 429.

import { splitCommandArguments } from '../cli/command-arguments.mjs';

export const PAPERS_USAGE = 'ai1 papers search "<query>" [--source openalex|semantic-scholar] [--limit 10] [--json]';
export const PAPER_SOURCES = ['openalex', 'semantic-scholar'];
const DEFAULT_PAPER_LIMIT = 10;
const MAX_PAPER_LIMIT = 50;
const FETCH_TIMEOUT_MILLISECONDS = 15000;
const ABSTRACT_SNIPPET_CHARACTERS = 400;
const VALUE_OPTIONS = new Set(['--source', '--limit']);

// OpenAlex keeps abstracts as an inverted index ({ word: [positions] }) for licensing reasons.
export function rebuildInvertedAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const wordsByPosition = [];
  for (const [abstractWord, wordPositions] of Object.entries(invertedIndex)) {
    for (const wordPosition of wordPositions) wordsByPosition[wordPosition] = abstractWord;
  }
  return wordsByPosition.filter(Boolean).join(' ');
}

function shortenAbstract(abstractText) {
  if (!abstractText) return null;
  const flatText = abstractText.replace(/\s+/g, ' ').trim();
  return flatText.length > ABSTRACT_SNIPPET_CHARACTERS ? `${flatText.slice(0, ABSTRACT_SNIPPET_CHARACTERS).trimEnd()}...` : flatText;
}

function buildOpenAlexRequest(searchQuery, paperLimit, environment) {
  const searchParameters = new URLSearchParams({
    search: searchQuery,
    'per-page': String(paperLimit),
    select: 'id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index',
  });
  if (environment.OPENALEX_API_KEY) searchParameters.set('api_key', environment.OPENALEX_API_KEY);
  return { url: `https://api.openalex.org/works?${searchParameters}`, headers: {} };
}

function readOpenAlexPapers(responseBody) {
  return (responseBody.results || []).map((openAlexWork) => ({
    title: openAlexWork.display_name || null,
    year: openAlexWork.publication_year ?? null,
    authors: (openAlexWork.authorships || []).map((authorship) => authorship.author?.display_name).filter(Boolean),
    venue: openAlexWork.primary_location?.source?.display_name || null,
    doi: openAlexWork.doi ? openAlexWork.doi.replace(/^https?:\/\/doi\.org\//, '') : null,
    url: openAlexWork.doi || openAlexWork.primary_location?.landing_page_url || openAlexWork.id || null,
    citations: openAlexWork.cited_by_count ?? null,
    abstract: shortenAbstract(rebuildInvertedAbstract(openAlexWork.abstract_inverted_index)),
  }));
}

function buildSemanticScholarRequest(searchQuery, paperLimit, environment) {
  const searchParameters = new URLSearchParams({
    query: searchQuery,
    limit: String(paperLimit),
    fields: 'title,year,authors,venue,externalIds,url,citationCount,abstract',
  });
  const requestHeaders = environment.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': environment.SEMANTIC_SCHOLAR_API_KEY } : {};
  return { url: `https://api.semanticscholar.org/graph/v1/paper/search?${searchParameters}`, headers: requestHeaders };
}

function readSemanticScholarPapers(responseBody) {
  return (responseBody.data || []).map((semanticScholarPaper) => {
    const paperDoi = semanticScholarPaper.externalIds?.DOI || null;
    return {
      title: semanticScholarPaper.title || null,
      year: semanticScholarPaper.year ?? null,
      authors: (semanticScholarPaper.authors || []).map((paperAuthor) => paperAuthor.name).filter(Boolean),
      venue: semanticScholarPaper.venue || null,
      doi: paperDoi,
      url: paperDoi ? `https://doi.org/${paperDoi}` : semanticScholarPaper.url || null,
      citations: semanticScholarPaper.citationCount ?? null,
      abstract: shortenAbstract(semanticScholarPaper.abstract),
    };
  });
}

const SOURCE_ADAPTERS = {
  openalex: { label: 'OpenAlex', buildRequest: buildOpenAlexRequest, readPapers: readOpenAlexPapers },
  'semantic-scholar': { label: 'Semantic Scholar', buildRequest: buildSemanticScholarRequest, readPapers: readSemanticScholarPapers },
};

async function defaultFetchJson(requestUrl, requestHeaders) {
  const sourceResponse = await fetch(requestUrl, {
    headers: { 'User-Agent': 'ai1', Accept: 'application/json', ...requestHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS),
  });
  if (!sourceResponse.ok) {
    throw new Error(sourceResponse.status === 429 ? 'HTTP 429, rate limited (a free API key in the environment raises the limit)' : `HTTP ${sourceResponse.status}`);
  }
  return sourceResponse.json();
}

export async function searchPapers(searchQuery, { source = 'openalex', limit = DEFAULT_PAPER_LIMIT, environment = process.env, fetchJson = defaultFetchJson } = {}) {
  const sourceAdapter = SOURCE_ADAPTERS[source];
  const { url, headers } = sourceAdapter.buildRequest(searchQuery, limit, environment);
  const responseBody = await fetchJson(url, headers);
  return sourceAdapter.readPapers(responseBody).slice(0, limit);
}

export function formatPapers(searchQuery, sourceLabel, papers) {
  if (!papers.length) return `${sourceLabel}: no papers for "${searchQuery}"`;
  const paperBlocks = papers.map((paper, paperIndex) => {
    const authorText = paper.authors.length > 3 ? `${paper.authors.slice(0, 3).join(', ')} et al.` : paper.authors.join(', ');
    const headerLine = `${paperIndex + 1}. ${paper.title} (${paper.year ?? 'n.d.'})`;
    const detailLine = [authorText, paper.venue, paper.citations === null ? null : `${paper.citations} citations`].filter(Boolean).join(' | ');
    return [headerLine, detailLine && `   ${detailLine}`, paper.url && `   ${paper.url}`, paper.abstract && `   ${paper.abstract}`].filter(Boolean).join('\n');
  });
  return [`${sourceLabel}: ${papers.length} paper(s) for "${searchQuery}"`, ...paperBlocks].join('\n');
}

export async function runPapersCommand(commandArguments, { fetchJson, environment } = {}) {
  const { positionalArguments, optionValues } = splitCommandArguments(commandArguments, VALUE_OPTIONS);
  const [subcommandName, ...queryWords] = positionalArguments;
  const searchQuery = queryWords.join(' ').trim();
  const source = optionValues['--source'] || 'openalex';
  const limit = optionValues['--limit'] === undefined ? DEFAULT_PAPER_LIMIT : Number(optionValues['--limit']);
  if (subcommandName !== 'search' || !searchQuery) return { output: `usage: ${PAPERS_USAGE}`, exitCode: 1 };
  if (!SOURCE_ADAPTERS[source]) return { output: `ai1: unknown source "${source}" (${PAPER_SOURCES.join(', ')})`, exitCode: 1 };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAPER_LIMIT) return { output: `ai1: --limit must be a whole number from 1 to ${MAX_PAPER_LIMIT}`, exitCode: 1 };
  const sourceLabel = SOURCE_ADAPTERS[source].label;
  try {
    const papers = await searchPapers(searchQuery, { source, limit, fetchJson, environment });
    return { output: optionValues['--json'] ? JSON.stringify(papers, null, 2) : formatPapers(searchQuery, sourceLabel, papers), exitCode: 0 };
  } catch (fetchError) {
    const reasonText = fetchError.name === 'TimeoutError' ? `no answer in ${FETCH_TIMEOUT_MILLISECONDS / 1000} s` : fetchError.message;
    return { output: `ai1: no source answered - ${sourceLabel}: ${reasonText}`, exitCode: 1 };
  }
}
