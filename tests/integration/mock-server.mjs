// Local HTTP mock server for integration tests.
// Starts on a random OS-assigned port so parallel test runs never collide.
import http from 'node:http'

export function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port, url: `http://127.0.0.1:${port}` })
    })
    server.on('error', reject)
  })
}

export function stopServer(server) {
  return new Promise((resolve) => server.close(resolve))
}

// Returns an OpenAI-compatible success response wrapping responseJson as content.
export function makeSuccessHandler(responseJson) {
  return (_req, res) => {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(responseJson) } }],
    })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  }
}

// Returns an OpenAI-compatible success response with raw string content (for lesson/markdown responses).
export function makeMarkdownHandler(markdownContent) {
  return (_req, res) => {
    const body = JSON.stringify({
      choices: [{ message: { content: markdownContent } }],
    })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  }
}

// Simulates an invalid-API-key rejection from the provider.
export function makeAuthErrorHandler() {
  return (_req, res) => {
    const body = JSON.stringify({
      error: { type: 'authentication_error', message: 'Invalid API key' },
    })
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(body)
  }
}
