export async function handleFixtureRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  if (path === '/workspace-data.js') {
    await Bun.sleep(350)
    return new Response('window.fixtureDataReady = true;', {
      headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' },
    })
  }
  if (path === '/' || path === '/fixture.js') {
    return new Response(Bun.file(new URL(path === '/' ? 'index.html' : 'fixture.js', import.meta.url)), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  return new Response('Not found', { status: 404 })
}
