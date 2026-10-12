// Local-only static server and synthetic Supabase provider. No hosted requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        if (path.extname(file) === '.html') {
            // Prevent CDN assets from overwriting the synthetic SDK. This fixture
            // has no network routes to hosted services or real Auth endpoints.
            const html = data.toString().replace(/<script\b[^>]*src="https:[^"]*"[^>]*><\/script>/g, '')
                .replace(/<link\b[^>]*(?:href="https:[^"]*")[^>]*>/g, '');
            response.end(html);
        } else response.end(data);
    });
}).listen(5203, '127.0.0.1', () => console.log('ZolTrack static fixture on 5203'));
