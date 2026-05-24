// Stub — DjVuPage.createPngObjectUrl() uses this but we never call it.
// We call getImageData() + canvas instead, so this path is never reached.
export default { PNG: { sync: { write: () => new Uint8Array(0) } } }
