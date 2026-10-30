/**
 * A stand-in for the shell, for the gallery sections that only exist inside one.
 *
 * Its own module with nothing imported, because it has to run before anything
 * else is: whether the page is inside Tauri is decided the moment the launch
 * module is first imported, so a gallery entry calls this and only then
 * imports the gallery.
 */
export function installFakeShell(): void {
  const show = new URLSearchParams(window.location.search).get('show') ?? ''
  if (!show.startsWith('launch-') && show !== 'previous-run') return

  let next = 1
  ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => next++,
    invoke: (command: string) => {
      if (command === 'claim_open_requests') {
        return Promise.resolve(['/Users/somebody/Report.docx'])
      }
      if (command === 'previous_run') {
        return Promise.resolve({
          marker: 'pid=1 started=1',
          launchLog: '/Users/somebody/Library/Application Support/com.orangery/logs/launch.log',
          crashLog: null,
        })
      }
      return Promise.resolve(null)
    },
  }
}
