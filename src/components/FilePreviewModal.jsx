// S – single responsibility: renders the preview modal only
// I – receives only the props it needs

import React from 'react';
import { X, Loader2 } from 'lucide-react';

/**
 * @param {{ item: {key: string, type: 'image'|'pdf'}|null, objectUrl: string|null, isLoading: boolean, onClose: () => void }} props
 */
const FilePreviewModal = ({ item, objectUrl, isLoading, onClose }) => {
    if (!item) return null;

    const fileName = item.key.split('/').pop();

    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-slate-800 rounded-xl shadow-2xl border border-slate-700 flex flex-col overflow-hidden"
                style={{ maxWidth: '92vw', maxHeight: '92vh', width: item.type === 'pdf' ? '82vw' : 'fit-content' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-slate-700 flex-shrink-0">
                    <h3 className="text-sm font-semibold text-slate-100 truncate max-w-lg">{fileName}</h3>
                    <button
                        onClick={onClose}
                        className="ml-4 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-700 flex-shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div
                    className="flex items-center justify-center overflow-auto"
                    style={{ height: 'calc(92vh - 52px)' }}
                >
                    {isLoading ? (
                        <Loader2 className="animate-spin text-slate-500" size={48} />
                    ) : item.type === 'image' && objectUrl ? (
                        <img
                            src={objectUrl}
                            alt={fileName}
                            className="max-w-full max-h-full object-contain"
                        />
                    ) : item.type === 'pdf' && objectUrl ? (
                        <iframe
                            src={objectUrl}
                            title={fileName}
                            className="w-full h-full border-0"
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default FilePreviewModal;
