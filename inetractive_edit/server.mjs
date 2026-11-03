import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makeCatalog } from './catalog.mjs';
import { previewHtml, readDocument, safeFile, saveDocument } from './storage.mjs';

const softwareRoot = fileURLToPath(new URL('./', import.meta.url));

export async function readRequestBody(request, limit = 9_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Error('Document too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length).toString('utf8');
}

export async function createEditorServer(options = {}) {
  const siteRoot = options.siteRoot ?? path.resolve(softwareRoot, '..');
  const defaultWorkspace = options.defaultWorkspace ?? 'interactive';
  const configured = options.workspaces ?? (options.dataRoot
    ? { interactive: { dataRoot: options.dataRoot, catalog: options.catalog } }
    : {
      interactive: { dataRoot: path.resolve(softwareRoot, '../interactive') },
      interactive_beta: { dataRoot: path.resolve(softwareRoot, '../interactive_beta') },
    });
  const workspaces = new Map();
  for (const [id, value] of Object.entries(configured)) {
    const config = typeof value === 'string' ? { dataRoot: value } : value;
    const dataRoot = path.resolve(config.dataRoot);
    const catalog = config.catalog ?? (id === defaultWorkspace ? options.catalog : undefined);
    workspaces.set(id, { id, dataRoot, catalog });
  }
  if (!workspaces.has(defaultWorkspace)) throw new Error(`Unknown default workspace: ${defaultWorkspace}`);
  const workspaceOptions = [...workspaces.keys()].map((id) => ({ id, label: id }));
  const loadWorkspace = async (id) => {
    const workspace = workspaces.get(id);
    if (!workspace) throw new Error('Unknown workspace');
    if (!workspace.catalog) {
      workspace.catalogPromise ??= makeCatalog(workspace.dataRoot);
      workspace.catalog = await workspace.catalogPromise;
    }
    return workspace;
  };
  const workspaceFor = (url) => {
    const id = url.searchParams.get('workspace') ?? defaultWorkspace;
    const workspace = workspaces.get(id);
    if (!workspace) throw new Error('Unknown workspace');
    return workspace;
  };
  const defaultConfig = workspaces.get(defaultWorkspace);
  const token = randomBytes(24).toString('hex');
  let saving = false;
  const json = (response, code, value) => response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.headers.host && !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(request.headers.host)) return json(response, 403, { error: 'Local requests only' });
      if (url.pathname === '/api/catalog') {
        const workspace = await loadWorkspace(workspaceFor(url).id);
        return json(response, 200, { ...workspace.catalog, token, workspace: workspace.id, workspaces: workspaceOptions });
      }
      if (url.pathname === '/api/document') {
        const workspace = await loadWorkspace(workspaceFor(url).id);
        return json(response, 200, await readDocument(workspace.dataRoot, url.searchParams.get('page'), workspace.catalog.pages));
      }
      if (url.pathname === '/document') {
        const workspace = await loadWorkspace(workspaceFor(url).id);
        const page = url.searchParams.get('page');
        const document = await readDocument(workspace.dataRoot, page, workspace.catalog.pages);
        return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "script-src 'none'; object-src 'none'" }).end(previewHtml(document.html, page, workspace.id));
      }
      if (url.pathname === '/api/save' && request.method === 'POST') {
        if (request.headers['x-editor-token'] !== token) return json(response, 403, { error: 'Invalid editor session' });
        const workspace = await loadWorkspace(workspaceFor(url).id);
        if (saving) return json(response, 409, { error: 'Another save is in progress' });
        const body = await readRequestBody(request);
        saving = true;
        try { return json(response, 200, await saveDocument(workspace.dataRoot, JSON.parse(body), workspace.catalog.pages)); }
        finally { saving = false; }
      }
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf' };
      let filename;
      if (url.pathname === '/vendor/lucide.js') filename = path.join(softwareRoot, 'node_modules/lucide/dist/umd/lucide.js');
      else if (url.pathname.startsWith('/book/')) {
        const workspace = workspaceFor(url);
        filename = safeFile(workspace.dataRoot, decodeURIComponent(url.pathname.slice(6)));
      }
      else {
        const workspaceEntry = [...workspaces].find(([id]) => url.pathname.startsWith(`/${id}/`));
        if (workspaceEntry) filename = safeFile(workspaceEntry[1].dataRoot, decodeURIComponent(url.pathname.slice(workspaceEntry[0].length + 2)));
      }
      if (!filename && (url.pathname.startsWith('/styles/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/Surah/Style_CSS/') || url.pathname === '/fonts.css')) filename = safeFile(siteRoot, decodeURIComponent(url.pathname.slice(1)));
      else if (!filename && ['/', '/index.html', '/app.js', '/app.css'].includes(url.pathname)) filename = path.join(softwareRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      else if (!filename) return response.writeHead(404).end('Not found');
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      return response.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(await readFile(filename));
    } catch (error) {
      return json(response, error.code === 'ENOENT' ? 404 : /changed/.test(error.message) ? 409 : 400, { error: error.message });
    }
  });
  return { server, catalog: defaultConfig.catalog ?? null, dataRoot: defaultConfig.dataRoot, workspaces: workspaceOptions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, workspaces } = await createEditorServer();
  let port = Number(process.env.PORT ?? 4180);
  server.on('error', (error) => { if (error.code === 'EADDRINUSE') server.listen(++port, '127.0.0.1'); else throw error; });
  server.on('listening', () => console.log(`Visual editor: http://127.0.0.1:${port}/ (${workspaces.map((item) => item.label).join(', ')})`));
  server.listen(port, '127.0.0.1');
}