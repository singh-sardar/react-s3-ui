// S – single responsibility: file type detection and public URL computation

const IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif',
]);

const MIME_MAP = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    avif: 'image/avif',
    pdf: 'application/pdf',
};

/**
 * Returns 'image', 'pdf', or null based on the file extension.
 * @param {string} key
 * @returns {'image' | 'pdf' | null}
 */
export function getPreviewType(key) {
    const ext = key.split('.').pop()?.toLowerCase();
    if (!ext) return null;
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return null;
}

/**
 * Returns the MIME type for a given S3 key.
 * @param {string} key
 * @returns {string}
 */
export function getMimeType(key) {
    const ext = key.split('.').pop()?.toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Builds the public URL for an object in a bucket.
 * @param {string} endpoint
 * @param {string} bucket
 * @param {string} key
 * @returns {string}
 */
export function getPublicUrl(endpoint, bucket, key) {
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
}

/**
 * URL-encodes an S3 key while preserving forward slashes.
 * This is needed for keys containing spaces, unicode, or reserved characters.
 * @param {string} key
 * @returns {string}
 */
export function encodeS3Key(key) {
    return key.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Creates a properly encoded CopySource string for S3 CopyObjectCommand.
 * @param {string} bucket
 * @param {string} key
 * @returns {string}
 */
export function encodeCopySource(bucket, key) {
    return `${encodeURIComponent(bucket)}/${encodeS3Key(key)}`;
}

/**
 * Reads every child FileSystemEntry of a directory reader. The reader returns
 * entries in batches, so it must be drained until it yields an empty batch.
 * @param {FileSystemDirectoryReader} reader
 * @returns {Promise<FileSystemEntry[]>}
 */
function readAllDirEntries(reader) {
    return new Promise((resolve, reject) => {
        const all = [];
        const readBatch = () => {
            reader.readEntries((batch) => {
                if (batch.length === 0) resolve(all);
                else {
                    all.push(...batch);
                    readBatch();
                }
            }, reject);
        };
        readBatch();
    });
}

/**
 * Recursively reads a drag-and-drop FileSystemEntry, returning a flat list of
 * { file, path } where `path` is the file's path relative to the dropped root
 * (preserving folder structure for directory drops).
 * @param {FileSystemEntry} entry
 * @param {string} basePath - accumulated parent path (with trailing slash)
 * @returns {Promise<Array<{ file: File, path: string }>>}
 */
export async function readEntryRecursive(entry, basePath = '') {
    if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        return [{ file, path: `${basePath}${file.name}` }];
    }
    if (entry.isDirectory) {
        const childEntries = await readAllDirEntries(entry.createReader());
        const results = await Promise.all(
            childEntries.map((child) => readEntryRecursive(child, `${basePath}${entry.name}/`))
        );
        return results.flat();
    }
    return [];
}

/**
 * Extracts a flat list of { file, path } from a drop event's DataTransfer.
 * Supports folders (via the webkitGetAsEntry API) and falls back to a plain
 * file list when the entry API is unavailable.
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<Array<{ file: File, path: string }>>}
 */
export async function getEntriesFromDataTransfer(dataTransfer) {
    const items = dataTransfer.items;
    // Collect FileSystemEntry objects synchronously: they become invalid once
    // the event handler yields to the event loop (await).
    const roots = [];
    if (items?.length && typeof items[0]?.webkitGetAsEntry === 'function') {
        for (const item of items) {
            const entry = item.webkitGetAsEntry();
            if (entry) roots.push(entry);
        }
    }

    if (roots.length === 0) {
        return Array.from(dataTransfer.files || []).map((file) => ({ file, path: file.name }));
    }

    const results = await Promise.all(roots.map((root) => readEntryRecursive(root)));
    return results.flat();
}
