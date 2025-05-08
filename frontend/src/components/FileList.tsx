import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { fileService } from '../services/fileService';
import { DocumentIcon, TrashIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useDebounce } from '../hooks/useDebounce';
import { File as FileType } from '../types/file';

type SortField = 'name' | 'size' | 'date' | 'type';
type SortOrder = 'asc' | 'desc';

// Add constants for configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const ROW_HEIGHT = 80; // Height of each row in pixels
const SEARCH_DEBOUNCE_MS = 300;

interface AutoSizerProps {
  height: number;
  width: number;
}

// Add error boundary component
class FileListErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('FileList error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <h3 className="text-red-800 font-medium">Something went wrong</h3>
          <p className="text-red-600 mt-1">Please refresh the page and try again.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * FileList Component
 * 
 * Displays a list of uploaded files with sorting and filtering capabilities.
 * Handles file downloads and deletions with optimistic updates.
 */
export const FileList: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  // Add offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  /**
   * Fetch files using React Query
   * Handles loading and error states automatically
   */
  const { data: files = [], isLoading, error } = useQuery({
    queryKey: ['files'],
    queryFn: fileService.getFiles,
  });

  // Add retry mechanism with exponential backoff
  const retryOperation = useCallback(async (operation: () => Promise<void>, maxRetries = MAX_RETRIES) => {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        await operation();
        return;
      } catch (err) {
        retries++;
        if (retries === maxRetries) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * RETRY_DELAY_MS));
      }
    }
  }, []);

  /**
   * Delete file mutation with optimistic updates
   */
  const deleteMutation = useMutation({
    mutationFn: fileService.deleteFile,
    onMutate: async (fileId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['files'] });

      // Snapshot the previous value
      const previousFiles = queryClient.getQueryData<FileType[]>(['files']);

      // Optimistically update to the new value
      queryClient.setQueryData<FileType[]>(['files'], (old) =>
        old?.filter((file) => file.id !== fileId) ?? []
      );

      return { previousFiles };
    },
    onError: (err, fileId, context) => {
      // Revert to the previous value on error
      if (context?.previousFiles) {
        queryClient.setQueryData(['files'], context.previousFiles);
      }
    },
    onSettled: () => {
      // Refetch files after mutation
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });

  /**
   * Download file mutation
   */
  const downloadMutation = useMutation({
    mutationFn: ({ fileUrl, filename }: { fileUrl: string; filename: string }) =>
      fileService.downloadFile(fileUrl, filename),
  });

  /**
   * Filter files based on search query
   * Case-insensitive search on filename and file type
   */
  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      const searchLower = debouncedSearchQuery.toLowerCase();
      return (
        file.original_filename.toLowerCase().includes(searchLower) ||
        file.file_type.toLowerCase().includes(searchLower)
      );
    });
  }, [files, debouncedSearchQuery]);

  /**
   * Sort files based on selected field and order
   */
  const sortedFiles = useMemo(() => {
    return [...filteredFiles].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.original_filename.localeCompare(b.original_filename);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'date':
          comparison = new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime();
          break;
        case 'type':
          comparison = a.file_type.localeCompare(b.file_type);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredFiles, sortField, sortOrder]);

  /**
   * Handle sort field change
   * Toggles sort order if clicking the same field
   */
  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField, sortOrder]);

  /**
   * Format file size to human-readable format
   */
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  /**
   * Format date to localized string
   */
  const formatDate = useCallback((dateString: string): string => {
    return new Date(dateString).toLocaleString();
  }, []);

  /**
   * Handle file download
   */
  const handleDownload = useCallback((fileUrl: string, filename: string) => {
    downloadMutation.mutate({ fileUrl, filename });
  }, [downloadMutation]);

  /**
   * Handle file deletion
   */
  const handleDelete = useCallback((fileId: string) => {
    deleteMutation.mutate(fileId);
  }, [deleteMutation]);

  /**
   * Check if an operation is pending for a file
   */
  const isOperationPending = useCallback((fileId: string): boolean => {
    return (
      downloadMutation.isPending ||
      deleteMutation.isPending ||
      downloadMutation.variables?.filename === fileId ||
      deleteMutation.variables === fileId
    );
  }, [downloadMutation, deleteMutation]);

  // Render loading state
  if (isLoading) {
    return <div className="loading">Loading files...</div>;
  }

  // Render error state
  if (error) {
    return <div className="error">Error loading files: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  // Render the component
  return (
    <FileListErrorBoundary>
      <div className="space-y-4">
        {!isOnline && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-yellow-800">You are offline. Some features may be limited.</p>
          </div>
        )}
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Uploaded Files</h2>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="mt-6 flow-root">
            <div className="overflow-x-auto">
              <div className="min-w-full divide-y divide-gray-200">
                <div className="bg-gray-50">
                  <div className="grid grid-cols-5 gap-4 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button
                      onClick={() => handleSort('name')}
                      className="flex items-center space-x-1"
                    >
                      <span>Name</span>
                      <ChevronUpDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleSort('type')}
                      className="flex items-center space-x-1"
                    >
                      <span>Type</span>
                      <ChevronUpDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleSort('size')}
                      className="flex items-center space-x-1"
                    >
                      <span>Size</span>
                      <ChevronUpDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleSort('date')}
                      className="flex items-center space-x-1"
                    >
                      <span>Upload Date</span>
                      <ChevronUpDownIcon className="h-4 w-4" />
                    </button>
                    <div className="text-right">Actions</div>
                  </div>
                </div>
                <div className="bg-white" style={{ height: '600px' }}>
                  <AutoSizer>
                    {({ height, width }: AutoSizerProps) => (
                      <List
                        height={height}
                        itemCount={sortedFiles.length}
                        itemSize={ROW_HEIGHT}
                        width={width}
                      >
                        {({ index, style }: { index: number; style: React.CSSProperties }) => {
                          const file = sortedFiles[index];
                          const isPending = isOperationPending(file.id);

                          return (
                            <div style={style} className={`border-b border-gray-200 ${isPending ? 'opacity-50' : ''}`}>
                              <div className="px-6 py-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-4">
                                    <DocumentIcon className="h-8 w-8 text-gray-400" />
                                    <div>
                                      <div className="text-sm font-medium text-gray-900">
                                        {file.original_filename}
                                      </div>
                                      <div className="text-sm text-gray-500">
                                        {file.file_type} • {formatFileSize(file.size)}
                                      </div>
                                      <div className="text-sm text-gray-500">
                                        {formatDate(file.uploaded_at)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex space-x-2">
                                    <button
                                      onClick={() => handleDownload(file.file, file.original_filename)}
                                      disabled={isPending}
                                      className="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                                    >
                                      <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                                      {isPending ? 'Downloading...' : 'Download'}
                                    </button>
                                    <button
                                      onClick={() => handleDelete(file.id)}
                                      disabled={isPending}
                                      className="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                                    >
                                      <TrashIcon className="h-4 w-4 mr-1" />
                                      {isPending ? 'Deleting...' : 'Delete'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </List>
                    )}
                  </AutoSizer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FileListErrorBoundary>
  );
}; 