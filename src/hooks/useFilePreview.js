// S – single responsibility: manages preview state and data fetching
// D – depends on the S3 client abstraction, not on a concrete implementation

import { useState, useCallback } from 'react';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getPreviewType, getMimeType } from '../utils/fileUtils';

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string|null} bucket
 * @param {(msg: string, type: string) => void} showAlert
 */
export function useFilePreview(s3Client, bucket, showAlert) {
    const [previewItem, setPreviewItem] = useState(null);
    const [previewObjectUrl, setPreviewObjectUrl] = useState(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);

    const openPreview = useCallback(async (key) => {
        const type = getPreviewType(key);
        if (!type || !s3Client || !bucket) return;

        // Show modal with spinner immediately
        setPreviewItem({ key, type });
        setPreviewObjectUrl(null);
        setIsLoadingPreview(true);

        try {
            const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const data = await response.Body.transformToByteArray();
            const blob = new Blob([data], { type: getMimeType(key) });
            setPreviewObjectUrl(URL.createObjectURL(blob));
        } catch (err) {
            showAlert(`Failed to preview "${key.split('/').pop()}".`, 'error');
            setPreviewItem(null);
        } finally {
            setIsLoadingPreview(false);
        }
    }, [s3Client, bucket, showAlert]);

    const closePreview = useCallback(() => {
        // Revoke the blob URL to free memory
        setPreviewObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setPreviewItem(null);
        setIsLoadingPreview(false);
    }, []);

    return { previewItem, previewObjectUrl, isLoadingPreview, openPreview, closePreview };
}
