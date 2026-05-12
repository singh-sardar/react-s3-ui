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
