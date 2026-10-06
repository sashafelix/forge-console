/** Explicit native-window registration; neither a matching URL nor file:// alone is trust. */
const windows = new Map<number, Set<string>>();
type Frame = { url: string; routingId: number; processId: number };
export function registerTrustedSender(id: number, urls: string[]): () => void {
  windows.set(id, new Set(urls));
  return () => windows.delete(id);
}
export function assertTrustedSender(event: { sender: { id: number; mainFrame: Frame }; senderFrame: Frame | null }): void {
  const allowed = windows.get(event.sender.id);
  const frame = event.senderFrame;
  if (!frame || !allowed || frame.routingId !== event.sender.mainFrame.routingId || frame.processId !== event.sender.mainFrame.processId) throw new Error('IPC requires the registered application main frame.');
  const parsed = new URL(frame.url); parsed.hash = '';
  if (!allowed.has(parsed.toString())) throw new Error('IPC sender is not an application page.');
}
