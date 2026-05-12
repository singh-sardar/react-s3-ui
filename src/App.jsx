import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, CreateBucketCommand, DeleteBucketCommand, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { HardDrive, Folder, File, Plus, Upload as UploadIcon, Download, Trash2, X, ChevronsRight, Loader2, Power, AlertTriangle, CheckCircle, Info, Beaker, Save, Server, Trash, Search, RefreshCw, Pencil, Eye, Copy, MoreVertical } from 'lucide-react';
import { getPreviewType, getPublicUrl } from './utils/fileUtils';
import { useFilePreview } from './hooks/useFilePreview';
import FilePreviewModal from './components/FilePreviewModal';

// --- Custom Hooks ---

// Hook to sync state with localStorage
function useLocalStorage(key, initialValue) {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };

    return [storedValue, setValue];
}

const useAlert = () => {    
    const [alertData, setAlertData] = useState(null);
    const showAlert = useCallback((message, type = 'info', duration = 5000) => {
        const id = Date.now();
        setAlertData({ id, message, type });
        setTimeout(() => setAlertData(current => (current && current.id === id ? null : current)), duration);
    }, []);
    const hideAlert = useCallback(() => setAlertData(null), []);
    return { alertData, showAlert, hideAlert };
};

// --- Helper Components ---

const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const Alert = ({ message, type, onDismiss }) => {
    const baseClasses = "fixed top-5 right-5 max-w-sm w-full p-4 rounded-lg shadow-lg flex items-center space-x-3 z-50";
    const typeClasses = {
        success: 'bg-green-100 border border-green-400 text-green-800 dark:bg-green-900/50 dark:border-green-700 dark:text-green-200',
        error: 'bg-red-100 border border-red-400 text-red-800 dark:bg-red-900/50 dark:border-red-700 dark:text-red-200',
        info: 'bg-blue-100 border border-blue-400 text-blue-800 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-200',
    };
    const Icon = useMemo(() => {
        switch (type) {
            case 'success': return <CheckCircle className="h-5 w-5 text-green-600" />;
            case 'error': return <AlertTriangle className="h-5 w-5 text-red-600" />;
            case 'info': return <Info className="h-5 w-5 text-blue-600" />;
            default: return null;
        }
    }, [type]);
    if (!message) return null;
    return (
        <div className={`${baseClasses} ${typeClasses[type]}`}>
            <div className="flex-shrink-0">{Icon}</div>
            <div className="flex-1 text-sm font-medium">{message}</div>
            <button onClick={onDismiss} className="p-1 rounded-full hover:bg-black/10"><X className="h-4 w-4" /></button>
        </div>
    );
};

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-700"><X size={20} /></button>
                </div>
                <div className="p-6">{children}</div>
            </div>
        </div>
    );
};

const ContextMenu = ({ isOpen, onClose, items }) => {
    const ref = useRef(null);
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);
    if (!isOpen) return null;
    return (
        <div ref={ref} className="absolute right-0 top-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-30 w-44 py-1">
            {items.map((item, i) => (
                <button
                    key={i}
                    onClick={() => { item.action(); onClose(); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center space-x-2 hover:bg-slate-600 transition-colors ${item.danger ? 'text-red-400 hover:text-red-300' : 'text-slate-200'}`}
                >
                    <span className="flex-shrink-0">{item.icon}</span>
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
};

// --- Main Application Components ---

const ConnectionManager = ({ onConnect, isConnecting, showAlert }) => {
    const [endpoint, setEndpoint] = useState('http://127.0.0.1:9000');
    const [accessKey, setAccessKey] = useState('minioadmin');
    const [secretKey, setSecretKey] = useState('minioadmin');
    const [showSecret, setShowSecret] = useState(false);
    const [saveConnection, setSaveConnection] = useState(false);
    const [connectionName, setConnectionName] = useState('');
    const [savedConnections, setSavedConnections] = useLocalStorage('minio-connections', []);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState({ message: '', type: '' });
    
    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult({ message: '', type: '' });
        try {
            const client = new S3Client({
                endpoint: endpoint,
                region: 'us-east-1',
                credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
                forcePathStyle: true,
            });
            await client.send(new ListBucketsCommand({}));
            setTestResult({ message: 'Success! Connection is working.', type: 'success' });
        } catch (error) {
            let errorMessage = `Error: ${error.name}. `;
            if (error.name === 'NetworkError') {
                 errorMessage += 'This could be a CORS issue. Please check your Minio server\'s CORS configuration.';
            } else {
                 errorMessage += 'Check your credentials and endpoint URL.';
            }
            setTestResult({ message: errorMessage, type: 'error' });
        } finally {
            setIsTesting(false);
        }
    };

    const handleQuickConnect = (conn) => {
        const connectionDetails = { endpoint: conn.endpoint, accessKey: conn.accessKey, secretKey: conn.secretKey };
        onConnect(connectionDetails, false);
    };

    const handleDeleteConnection = (id) => {
        setSavedConnections(savedConnections.filter(c => c.id !== id));
        showAlert('Connection deleted.', 'info');
    };
    
    const handleLoadConnection = (conn) => {
        setEndpoint(conn.endpoint);
        setAccessKey(conn.accessKey);
        setSecretKey(conn.secretKey);
        setConnectionName(conn.name);
        setSaveConnection(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const connectionDetails = { endpoint, accessKey, secretKey };
        
        if (saveConnection && !connectionName.trim()) {
            showAlert('Please enter a name for the connection to save it.', 'error');
            return;
        }
        
        const saveConfig = saveConnection ? { name: connectionName, ...connectionDetails } : null;

        onConnect(connectionDetails, saveConfig);
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 p-4">
            <div className="w-full max-w-4xl mx-auto flex lg:flex-row flex-col gap-8">
                <div className="lg:w-1/3 w-full bg-slate-800 rounded-2xl shadow-2xl p-6 border border-slate-700 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                         <Server className="h-6 w-6 text-sky-400"/>
                        <h2 className="text-xl font-bold text-slate-100">Saved Connections</h2>
                    </div>
                    {savedConnections.length === 0 ? (
                        <p className="text-slate-400 text-sm text-center py-8">No saved connections yet.</p>
                    ) : (
                        <ul className="space-y-2 max-h-96 overflow-y-auto">
                            {savedConnections.map(conn => (
                                <li key={conn.id} className="bg-slate-900 p-3 rounded-md flex items-center justify-between gap-2">
                                    <div className="truncate cursor-pointer" onClick={() => handleLoadConnection(conn)}>
                                        <p className="font-semibold text-slate-200 truncate">{conn.name}</p>
                                        <p className="text-xs text-slate-400 truncate">{conn.endpoint}</p>
                                    </div>
                                    <div className="flex items-center flex-shrink-0">
                                        <button onClick={() => handleDeleteConnection(conn.id)} className="p-2 text-slate-500 hover:text-red-400 rounded-full hover:bg-slate-700"><Trash size={16}/></button>
                                        <button onClick={() => handleQuickConnect(conn)} className="p-2 text-slate-500 hover:text-sky-400 rounded-full hover:bg-slate-700"><Power size={16}/></button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="lg:w-2/3 w-full bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700">
                    <div className="text-center mb-8">
                        <HardDrive className="mx-auto h-12 w-12 text-sky-400" />
                        <h1 className="mt-4 text-2xl font-bold text-slate-100">Connect to Minio</h1>
                        <p className="mt-2 text-sm text-slate-400">Enter new or select a saved connection.</p>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-2">Endpoint URL</label>
                            <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="e.g., http://localhost:9000" className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition" required />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-2">Access Key ID</label>
                            <input type="text" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder="Your access key" className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition" required />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-2">Secret Access Key</label>
                            <div className="relative">
                                <input type={showSecret ? "text" : "password"} value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="Your secret key" className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition" required />
                                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-200">{showSecret ? 'Hide' : 'Show'}</button>
                            </div>
                        </div>
                        
                        {testResult.message && (
                            <div className={`p-3 rounded-md text-sm ${testResult.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                                {testResult.message}
                            </div>
                        )}

                         <div className="pt-2">
                             <div className="flex items-center">
                                 <input id="save-connection" type="checkbox" checked={saveConnection} onChange={(e) => setSaveConnection(e.target.checked)} className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500"/>
                                 <label htmlFor="save-connection" className="ml-2 block text-sm text-slate-300">Save Connection</label>
                             </div>
                             {saveConnection && (
                                <div className="mt-3">
                                    <label className="text-sm font-medium text-slate-300 block mb-2">Connection Name</label>
                                    <input type="text" value={connectionName} onChange={(e) => setConnectionName(e.target.value)} placeholder="e.g., Local Minio Server" className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition" required />
                                </div>
                             )}
                        </div>

                        <div className="flex items-center space-x-3 pt-2">
                            <button type="button" onClick={handleTestConnection} disabled={isTesting || isConnecting} className="w-1/2 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2.5 px-4 rounded-md flex items-center justify-center disabled:bg-slate-700 disabled:cursor-not-allowed transition-all duration-300">
                                {isTesting ? <Loader2 className="animate-spin mr-2" /> : <Beaker className="mr-2 h-5 w-5" />}
                                {isTesting ? 'Testing...' : 'Test'}
                            </button>
                            <button type="submit" disabled={isConnecting || isTesting} className="w-1/2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 px-4 rounded-md flex items-center justify-center disabled:bg-sky-800 disabled:cursor-not-allowed transition-all duration-300">
                                {isConnecting ? <Loader2 className="animate-spin mr-2" /> : <Power className="mr-2 h-5 w-5" />}
                                {isConnecting ? 'Connecting...' : 'Connect'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

function App() {
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedBucket = searchParams.get('bucket');
    const prefix = searchParams.get('prefix') ?? '';

    const setSelectedBucket = useCallback((bucket) => {
        setSearchParams(bucket ? { bucket } : {});
    }, [setSearchParams]);

    const setPrefix = useCallback((newPrefix) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (newPrefix) next.set('prefix', newPrefix);
            else next.delete('prefix');
            return next;
        });
    }, [setSearchParams]);

    const [s3Client, setS3Client] = useState(null);
    const [buckets, setBuckets] = useState([]);
    const [objects, setObjects] = useState([]);
    const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);
    const [isLoadingObjects, setIsLoadingObjects] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState([]);
    const [selectedItems, setSelectedItems] = useState([]);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [draggedKey, setDraggedKey] = useState(null);
    const [dropTargetKey, setDropTargetKey] = useState(null);
    const [openMenuKey, setOpenMenuKey] = useState(null);
    const draggedKeyRef = useRef(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [savedConnections, setSavedConnections] = useLocalStorage('minio-connections', []);
    const [connectionEndpoint, setConnectionEndpoint] = useState(null);
    
    const { alertData, showAlert, hideAlert } = useAlert();

    const handleConnect = useCallback(async (connectionDetails, saveConfig) => {
        try {
            const client = new S3Client({
                endpoint: connectionDetails.endpoint,
                region: 'us-east-1',
                credentials: { accessKeyId: connectionDetails.accessKey, secretAccessKey: connectionDetails.secretKey },
                forcePathStyle: true,
            });
            await client.send(new ListBucketsCommand({}));
            
            if (saveConfig) {
                const existingIndex = savedConnections.findIndex(c => c.name === saveConfig.name);
                if (existingIndex > -1) {
                    const updatedConnections = [...savedConnections];
                    updatedConnections[existingIndex] = { ...saveConfig, id: savedConnections[existingIndex].id };
                    setSavedConnections(updatedConnections);
                } else {
                    setSavedConnections([...savedConnections, { ...saveConfig, id: Date.now() }]);
                }
                 showAlert(`Connection "${saveConfig.name}" saved!`, 'success');
            }

            setS3Client(client);
            setConnectionEndpoint(connectionDetails.endpoint);
        } catch (error) {
            showAlert(`Connection failed: ${error.name}.`, 'error');
        }
    }, [savedConnections, setSavedConnections, showAlert]);

    const handleDisconnect = useCallback(() => {
        setS3Client(null);
        setConnectionEndpoint(null);
        setBuckets([]);
        setObjects([]);
        setSelectedItems([]);
        setSearchQuery('');
        setSearchParams({});
        showAlert('Disconnected.', 'info');
    }, [showAlert, setSearchParams]);

    const fetchBuckets = useCallback(async () => {
        if (!s3Client) return;
        setIsLoadingBuckets(true);
        try {
            const { Buckets } = await s3Client.send(new ListBucketsCommand({}));
            setBuckets(Buckets || []);
        } catch (error) {
            showAlert('Could not fetch buckets.', 'error');
        } finally {
            setIsLoadingBuckets(false);
        }
    }, [s3Client, showAlert]);

    const fetchObjects = useCallback(async (bucket, currentPrefix) => {
        if (!s3Client || !bucket) return;
        setIsLoadingObjects(true);
        setSelectedItems([]);
        setSearchQuery("");
        try {
            const command = new ListObjectsV2Command({ Bucket: bucket, Prefix: currentPrefix, Delimiter: '/' });
            const { Contents, CommonPrefixes } = await s3Client.send(command);
            const folders = (CommonPrefixes || []).map(p => ({ Key: p.Prefix, isFolder: true }));
            const files = (Contents || []).filter(c => c.Key !== currentPrefix).map(c => ({ ...c, isFolder: false }));
            setObjects([...folders, ...files]);
        } catch (error) {
            showAlert(`Could not list objects in ${bucket}.`, 'error');
        } finally {
            setIsLoadingObjects(false);
        }
    }, [s3Client, showAlert]);

     const handleFileUpload = async (files) => {
        if (!s3Client || !selectedBucket || !files.length) return;

        for (const file of files) {
            const uploadId = `${file.name}-${Date.now()}`;
            const key = `${prefix}${file.name}`;
            
            setUploadingFiles(prev => [...prev, { id: uploadId, name: file.name, progress: 0 }]);
            
            try {
                const parallelUploads3 = new Upload({
                    client: s3Client,
                    params: { Bucket: selectedBucket, Key: key, Body: file },
                });

                parallelUploads3.on("httpUploadProgress", (progress) => {
                     const percent = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
                     setUploadingFiles(prev => prev.map(f => f.id === uploadId ? { ...f, progress: percent } : f));
                });

                await parallelUploads3.done();
                showAlert(`File "${file.name}" uploaded successfully.`, 'success');
                fetchObjects(selectedBucket, prefix);
            } catch (err) {
                showAlert(`Failed to upload "${file.name}".`, 'error');
            } finally {
                setUploadingFiles(prev => prev.filter(f => f.id !== uploadId));
            }
        }
    };
    
    const handleDeleteSelected = async () => {
        if (!s3Client || !selectedBucket || selectedItems.length === 0) return;

        let allKeysToDelete = [];
        const getAllKeysInPrefix = async (prefixToDelete) => {
            let keys = [];
            let continuationToken;
            do {
                const command = new ListObjectsV2Command({ Bucket: selectedBucket, Prefix: prefixToDelete, ContinuationToken: continuationToken });
                const response = await s3Client.send(command);
                if (response.Contents) keys.push(...response.Contents.map(item => item.Key));
                continuationToken = response.NextContinuationToken;
            } while (continuationToken);
            return keys;
        };

        for (const key of selectedItems) {
            if (key.endsWith('/')) { // Folder
                allKeysToDelete.push(...await getAllKeysInPrefix(key));
            } else { // File
                allKeysToDelete.push(key);
            }
        }
        
        allKeysToDelete = [...new Set(allKeysToDelete)];
        if (allKeysToDelete.length === 0) {
            setIsDeleteModalOpen(false);
            return;
        }

        try {
            const deleteCommand = new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: allKeysToDelete.map(Key => ({ Key })) } });
            await s3Client.send(deleteCommand);
            showAlert(`${allKeysToDelete.length} item(s) deleted successfully.`, 'success');
        } catch (error) {
            showAlert('Failed to delete items.', 'error');
        } finally {
            setIsDeleteModalOpen(false);
            fetchObjects(selectedBucket, prefix);
        }
    };

    const collectAllKeysInPrefix = useCallback(async (prefixToScan) => {
        let keys = [];
        let continuationToken;
        do {
            const resp = await s3Client.send(new ListObjectsV2Command({ Bucket: selectedBucket, Prefix: prefixToScan, ContinuationToken: continuationToken }));
            if (resp.Contents) keys.push(...resp.Contents.map(c => c.Key));
            continuationToken = resp.NextContinuationToken;
        } while (continuationToken);
        return keys;
    }, [s3Client, selectedBucket]);

    const handleDeleteItem = useCallback(async (key, isFolder) => {
        const keysToDelete = isFolder ? await collectAllKeysInPrefix(key) : [key];
        if (keysToDelete.length === 0) { fetchObjects(selectedBucket, prefix); return; }
        try {
            await s3Client.send(new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: keysToDelete.map(Key => ({ Key })) } }));
            showAlert('Deleted successfully.', 'success');
        } catch (error) {
            showAlert('Failed to delete.', 'error');
        } finally {
            fetchObjects(selectedBucket, prefix);
        }
    }, [s3Client, selectedBucket, prefix, collectAllKeysInPrefix, showAlert, fetchObjects]);

    const openRenameModal = useCallback((obj) => {
        const currentName = obj.Key.replace(prefix, '').replace(/\/$/, '');
        setRenameTarget(obj);
        setRenameValue(currentName);
        setIsRenameModalOpen(true);
    }, [prefix]);

    const handleRenameItem = useCallback(async () => {
        const trimmedName = renameValue.trim();
        if (!trimmedName) { showAlert('Name cannot be empty.', 'error'); return; }
        if (trimmedName.includes('/')) { showAlert('Name cannot contain slashes.', 'error'); return; }

        const isFolder = renameTarget.isFolder;
        const oldKey = renameTarget.Key;
        const newKey = isFolder ? `${prefix}${trimmedName}/` : `${prefix}${trimmedName}`;

        if (oldKey === newKey) { setIsRenameModalOpen(false); return; }

        try {
            if (!isFolder) {
                await s3Client.send(new CopyObjectCommand({ Bucket: selectedBucket, CopySource: `${selectedBucket}/${oldKey}`, Key: newKey }));
                await s3Client.send(new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: [{ Key: oldKey }] } }));
            } else {
                const keys = await collectAllKeysInPrefix(oldKey);
                for (const k of keys) {
                    const newObjKey = newKey + k.slice(oldKey.length);
                    await s3Client.send(new CopyObjectCommand({ Bucket: selectedBucket, CopySource: `${selectedBucket}/${k}`, Key: newObjKey }));
                }
                if (keys.length > 0) {
                    await s3Client.send(new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: keys.map(Key => ({ Key })) } }));
                }
            }
            showAlert(`Renamed to "${trimmedName}" successfully.`, 'success');
            setIsRenameModalOpen(false);
            fetchObjects(selectedBucket, prefix);
        } catch (error) {
            showAlert('Failed to rename.', 'error');
        }
    }, [s3Client, selectedBucket, prefix, renameTarget, renameValue, collectAllKeysInPrefix, showAlert, fetchObjects]);

    const handleMoveItem = useCallback(async (sourceKey, targetFolderKey) => {
        const isFolder = sourceKey.endsWith('/');
        const parts = sourceKey.replace(/\/$/, '').split('/');
        const name = parts[parts.length - 1];
        const newKey = isFolder ? `${targetFolderKey}${name}/` : `${targetFolderKey}${name}`;
        if (sourceKey === newKey) return;
        if (isFolder && newKey.startsWith(sourceKey)) {
            showAlert('Cannot move a folder into itself.', 'error');
            return;
        }
        try {
            if (!isFolder) {
                await s3Client.send(new CopyObjectCommand({ Bucket: selectedBucket, CopySource: `${selectedBucket}/${sourceKey}`, Key: newKey }));
                await s3Client.send(new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: [{ Key: sourceKey }] } }));
            } else {
                const keys = await collectAllKeysInPrefix(sourceKey);
                for (const k of keys) {
                    const destKey = newKey + k.slice(sourceKey.length);
                    await s3Client.send(new CopyObjectCommand({ Bucket: selectedBucket, CopySource: `${selectedBucket}/${k}`, Key: destKey }));
                }
                if (keys.length > 0) {
                    await s3Client.send(new DeleteObjectsCommand({ Bucket: selectedBucket, Delete: { Objects: keys.map(Key => ({ Key })) } }));
                }
            }
            showAlert('Moved successfully.', 'success');
            fetchObjects(selectedBucket, prefix);
        } catch (error) {
            showAlert('Failed to move item.', 'error');
        }
    }, [s3Client, selectedBucket, prefix, collectAllKeysInPrefix, showAlert, fetchObjects]);

    const handleCreateFolder = useCallback(async () => {
        const trimmedName = newFolderName.trim();
        if (!trimmedName) {
            showAlert('Folder name cannot be empty.', 'error');
            return;
        }
        if (trimmedName.includes('/')) {
            showAlert('Folder name cannot contain slashes.', 'error');
            return;
        }
        const folderKey = `${prefix}${trimmedName}/`;
        try {
            await s3Client.send(new PutObjectCommand({ Bucket: selectedBucket, Key: folderKey, Body: '' }));
            showAlert(`Folder "${trimmedName}" created successfully.`, 'success');
            setIsCreateFolderModalOpen(false);
            setNewFolderName('');
            fetchObjects(selectedBucket, prefix);
        } catch (error) {
            showAlert(`Failed to create folder "${trimmedName}".`, 'error');
        }
    }, [s3Client, selectedBucket, prefix, newFolderName, showAlert, fetchObjects]);

    const handleDownload = async (key) => {        if (!s3Client || !selectedBucket) return;
        try {
            const command = new GetObjectCommand({ Bucket: selectedBucket, Key: key });
            const response = await s3Client.send(command);
            
            const data = await response.Body.transformToByteArray();
            const blob = new Blob([data], { type: response.ContentType });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', key.split('/').pop());
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
            
        } catch (error) {
            showAlert(`Failed to download "${key}".`, 'error');
        }
    };

    const { previewItem, previewObjectUrl, isLoadingPreview, openPreview, closePreview } = useFilePreview(s3Client, selectedBucket, showAlert);

    const handleCopyPublicUrl = useCallback(async (key) => {
        const url = getPublicUrl(connectionEndpoint, selectedBucket, key);
        try {
            await navigator.clipboard.writeText(url);
            showAlert('Public URL copied to clipboard.', 'success');
        } catch (err) {
            showAlert('Failed to copy URL.', 'error');
        }
    }, [connectionEndpoint, selectedBucket, showAlert]);
    
    useEffect(() => {
        if (s3Client) fetchBuckets();
    }, [s3Client, fetchBuckets]);

    useEffect(() => {
        if (s3Client) fetchObjects(selectedBucket, prefix);
    }, [selectedBucket, prefix, s3Client, fetchObjects]);
    
    const filteredObjects = useMemo(() => {
        if (!searchQuery) return objects;
        return objects.filter(obj => obj.Key.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [objects, searchQuery]);
    
    if (!s3Client) {
        return <ConnectionManager onConnect={handleConnect} isConnecting={false} showAlert={showAlert} />;
    }
    
    const breadcrumbs = ['Buckets', selectedBucket, ...prefix.split('/').filter(Boolean)];

    return (
        <div className="h-screen w-screen bg-slate-900 text-slate-300 flex flex-col font-sans overflow-hidden">
            <Alert message={alertData?.message} type={alertData?.type} onDismiss={hideAlert} />
            <header className="flex-shrink-0 bg-slate-800/50 border-b border-slate-700 p-2 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <HardDrive className="h-6 w-6 text-sky-400" />
                    <span className="font-semibold text-lg text-slate-100">Minio Explorer</span>
                </div>
                <div className="flex items-center space-x-4">
                    <span className="text-sm text-slate-400">Connected</span>
                    <button onClick={handleDisconnect} className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-3 rounded-md transition-colors">
                        <Power size={16} />
                        <span>Disconnect</span>
                    </button>
                </div>
            </header>
            <div className="flex flex-grow min-h-0">
                 <aside className="w-1/4 xl:w-1/5 bg-slate-800/30 p-4 border-r border-slate-700 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-slate-100">Buckets</h2>
                    </div>
                    {isLoadingBuckets ? (
                        <div className="flex-grow flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" size={32}/></div>
                    ) : (
                        <ul className="space-y-1 overflow-y-auto">
                            {buckets.map(bucket => (
                                <li key={bucket.Name}>
                                    <button onClick={() => setSearchParams({ bucket: bucket.Name })} className={`flex items-center space-x-3 p-2 rounded-md transition-colors w-full text-left ${selectedBucket === bucket.Name ? 'bg-sky-500/20 text-sky-300' : 'hover:bg-slate-700/50'}`}>
                                        <Folder size={18} className={`${selectedBucket === bucket.Name ? 'text-sky-400' : 'text-slate-500'}`} />
                                        <span className="truncate flex-1">{bucket.Name}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>
                <main className="flex-1 flex flex-col bg-slate-900 min-w-0">
                    <div className="flex-shrink-0 p-3 bg-slate-800/30 border-b border-slate-700 flex items-center justify-between gap-4">
                        <div className="flex-grow flex items-center text-sm text-slate-400 overflow-x-auto whitespace-nowrap">
                           {breadcrumbs.map((crumb, i) => (
                             <div key={i} className="flex items-center">
                               <button className="hover:text-white" onClick={() => {
                                 if (i === 0) { setSearchParams({}); }
                                 else if (i === 1) { setSearchParams({ bucket: selectedBucket }); }
                                 else { const newPrefix = breadcrumbs.slice(2, i + 1).join('/') + '/'; setSearchParams({ bucket: selectedBucket, prefix: newPrefix }); }
                               }}>{crumb}</button>
                               {i < breadcrumbs.length - 1 && <ChevronsRight size={16} className="mx-1 flex-shrink-0" />}
                             </div>
                           ))}
                        </div>
                        <div className="flex items-center space-x-2 flex-shrink-0">
                           {selectedBucket && (
                                <>
                                <button onClick={() => fetchObjects(selectedBucket, prefix)} disabled={isLoadingObjects} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors">
                                    {isLoadingObjects ? <Loader2 className="animate-spin h-4 w-4"/> : <RefreshCw className="h-4 w-4"/>}
                                </button>
                               <div className="relative">
                                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"/>
                                   <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md pl-9 pr-3 py-1.5 text-sm w-48 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition" />
                               </div>
                               </>
                           )}
                           {selectedItems.length > 0 && (
                                <button onClick={() => setIsDeleteModalOpen(true)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-3 rounded-md transition-colors cursor-pointer flex items-center space-x-2">
                                    <Trash2 size={16} />
                                    <span>Delete ({selectedItems.length})</span>
                                </button>
                           )}
                           {selectedBucket && (
                               <>
                               <button onClick={() => { setNewFolderName(''); setIsCreateFolderModalOpen(true); }} className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-1.5 px-3 rounded-md transition-colors flex items-center space-x-2">
                                   <Plus size={16} />
                                   <span>New Folder</span>
                               </button>
                               <label className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-1.5 px-3 rounded-md transition-colors cursor-pointer flex items-center space-x-2">
                                 <UploadIcon size={16} />
                                 <span>Upload</span>
                                 <input type="file" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                               </label>
                               </>
                           )}
                        </div>
                    </div>
                     <div className="flex-grow overflow-auto">
                        {!selectedBucket ? (
                             <div className="h-full flex flex-col items-center justify-center text-slate-500 p-8 text-center"><Folder size={48} className="mb-4" /> <h3 className="text-xl font-semibold">Select a bucket</h3> <p>Choose a bucket from the left panel to view its contents.</p></div>
                        ) : isLoadingObjects ? (
                            <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" size={40}/></div>
                        ) : (
                         <table className="w-full text-sm text-left">
                            <thead className="sticky top-0 bg-slate-800/80 backdrop-blur-sm z-10">
                                <tr>
                                    <th className="p-3 w-12 text-center">
                                        <input type="checkbox" className="bg-slate-700 border-slate-500 rounded" checked={filteredObjects.length > 0 && selectedItems.length === filteredObjects.length} onChange={() => {
                                            if (selectedItems.length === filteredObjects.length) setSelectedItems([]);
                                            else setSelectedItems(filteredObjects.map(o => o.Key));
                                        }} />
                                    </th>
                                    <th className="p-3 font-semibold text-slate-300 w-2/5">Name</th>
                                    <th className="p-3 font-semibold text-slate-300">Size</th>
                                    <th className="p-3 font-semibold text-slate-300">Last Modified</th>
                                    <th className="p-3 font-semibold text-slate-300 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {filteredObjects.map(obj => (
                                    <tr
                                        key={obj.Key}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.effectAllowed = 'move';
                                            draggedKeyRef.current = obj.Key;
                                            setDraggedKey(obj.Key);
                                        }}
                                        onDragEnd={() => {
                                            draggedKeyRef.current = null;
                                            setDraggedKey(null);
                                            setDropTargetKey(null);
                                        }}
                                        onDragOver={obj.isFolder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetKey(obj.Key); } : undefined}
                                        onDragLeave={obj.isFolder ? () => setDropTargetKey(prev => prev === obj.Key ? null : prev) : undefined}
                                        onDrop={obj.isFolder ? (e) => {
                                            e.preventDefault();
                                            const src = draggedKeyRef.current;
                                            if (src && src !== obj.Key && !src.startsWith(obj.Key)) {
                                                handleMoveItem(src, obj.Key);
                                            }
                                            draggedKeyRef.current = null;
                                            setDraggedKey(null);
                                            setDropTargetKey(null);
                                        } : undefined}
                                        className={[
                                            'transition-colors cursor-grab active:cursor-grabbing',
                                            selectedItems.includes(obj.Key) ? 'bg-sky-900/50' : '',
                                            dropTargetKey === obj.Key ? 'bg-emerald-900/40 ring-1 ring-inset ring-emerald-500' : '',
                                            !selectedItems.includes(obj.Key) && dropTargetKey !== obj.Key ? 'hover:bg-slate-800/50' : '',
                                            draggedKey === obj.Key ? 'opacity-40' : '',
                                        ].join(' ')}
                                    >
                                        <td className="p-3 text-center">
                                            <input type="checkbox" className="bg-slate-700 border-slate-500 rounded" checked={selectedItems.includes(obj.Key)} onChange={() => {
                                                setSelectedItems(prev => prev.includes(obj.Key) ? prev.filter(k => k !== obj.Key) : [...prev, obj.Key]);
                                            }} />
                                        </td>
                                        <td className="p-3">
                                            <button className="flex items-center space-x-2 group w-full text-left" onClick={() => { if(obj.isFolder) setSearchParams({ bucket: selectedBucket, prefix: obj.Key }); }}>
                                                {obj.isFolder ? <Folder className="text-sky-400" size={20} /> : <File className="text-slate-500" size={20} />}
                                                <span className={`${obj.isFolder ? 'text-slate-100 group-hover:text-sky-300 cursor-pointer' : 'text-slate-300 cursor-default'} truncate`}>{obj.Key.replace(prefix, '')}</span>
                                            </button>
                                        </td>
                                        <td className="p-3 text-slate-400">{!obj.isFolder && formatBytes(obj.Size)}</td>
                                        <td className="p-3 text-slate-400">{!obj.isFolder && obj.LastModified ? new Date(obj.LastModified).toLocaleString() : ''}</td>
                                        <td className="p-3 text-right">
                                            <div className="relative inline-block">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenMenuKey(prev => prev === obj.Key ? null : obj.Key); }}
                                                    className="p-2 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition"
                                                >
                                                    <MoreVertical size={16} />
                                                </button>
                                                <ContextMenu
                                                    isOpen={openMenuKey === obj.Key}
                                                    onClose={() => setOpenMenuKey(null)}
                                                    items={[
                                                        ...(!obj.isFolder ? [{ icon: <Download size={14}/>, label: 'Download', action: () => handleDownload(obj.Key) }] : []),
                                                        ...(!obj.isFolder && getPreviewType(obj.Key) ? [{ icon: <Eye size={14}/>, label: 'Preview', action: () => openPreview(obj.Key) }] : []),
                                                        ...(!obj.isFolder ? [{ icon: <Copy size={14}/>, label: 'Copy Public URL', action: () => handleCopyPublicUrl(obj.Key) }] : []),
                                                        { icon: <Pencil size={14}/>, label: 'Rename', action: () => openRenameModal(obj) },
                                                        { icon: <Trash2 size={14}/>, label: 'Delete', action: () => handleDeleteItem(obj.Key, obj.isFolder), danger: true },
                                                    ]}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                         </table>
                         )}
                     </div>
                </main>
            </div>
            <Modal isOpen={isRenameModalOpen} onClose={() => setIsRenameModalOpen(false)} title="Rename">
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-slate-300 block mb-2">New Name</label>
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameItem()}
                            autoFocus
                            className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition"
                        />
                    </div>
                    <div className="flex justify-end space-x-3 pt-2">
                        <button type="button" onClick={() => setIsRenameModalOpen(false)} className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold transition">Cancel</button>
                        <button type="button" onClick={handleRenameItem} className="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-700 text-white font-semibold transition">Rename</button>
                    </div>
                </div>
            </Modal>
            <Modal isOpen={isCreateFolderModalOpen} onClose={() => setIsCreateFolderModalOpen(false)} title="Create New Folder">
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-slate-300 block mb-2">Folder Name</label>
                        <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                            placeholder="e.g., my-folder"
                            autoFocus
                            className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition"
                        />
                    </div>
                    <div className="flex justify-end space-x-3 pt-2">
                        <button type="button" onClick={() => setIsCreateFolderModalOpen(false)} className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold transition">Cancel</button>
                        <button type="button" onClick={handleCreateFolder} className="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-700 text-white font-semibold transition">Create</button>
                    </div>
                </div>
            </Modal>
            <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Confirm Deletion">
                <div className="text-slate-300">
                    <p className="mb-4">Are you sure you want to permanently delete {selectedItems.length} item(s)? This action cannot be undone.</p>
                    <ul className="max-h-48 overflow-y-auto bg-slate-900/50 p-2 rounded-md border border-slate-700 space-y-1 mb-6">
                        {selectedItems.map(key => <li key={key} className="truncate text-sm">{key}</li>)}
                    </ul>
                    <div className="mt-6 flex justify-end space-x-3">
                        <button type="button" onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold transition">Cancel</button>
                        <button type="button" onClick={handleDeleteSelected} className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold transition">Delete</button>
                    </div>
                </div>
            </Modal>
            <FilePreviewModal item={previewItem} objectUrl={previewObjectUrl} isLoading={isLoadingPreview} onClose={closePreview} />
        </div>
    );
}

export default App;
