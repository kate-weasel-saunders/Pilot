/**
 * Hand a file to the user. On iPhone the share sheet is the most reliable
 * route (Save to Files, AirDrop…); elsewhere a normal download.
 */
export async function deliverFile(name: string, mime: string, content: string): Promise<void> {
  const file = new File([content], name, { type: mime });
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
