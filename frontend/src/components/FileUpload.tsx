import React, { useState, useRef, useCallback } from 'react';
import { fileService } from '../services/fileService';
import { File as FileType } from '../types/file';
import './FileUpload.css';

interface FileUploadProps {
  onUploadComplete: (file: FileType) => void;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * FileUpload Component
 * 
 * A reusable component that handles file uploads with drag-and-drop support,
 * file validation, and upload progress tracking.
 */
export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete }) => {
  // State management for drag-and-drop functionality
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [chunkProgress, setChunkProgress] = useState<number[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Validates the selected file against size and type constraints
   * @param file - The file to validate
   * @returns Error message if validation fails, null if valid
   */
  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return 'File size exceeds 100MB limit';
    }
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return 'File type not supported';
    }
    if (file.size === 0) {
      return 'File is empty';
    }
    return null;
  };

  /**
   * Handles drag enter event for the drop zone
   */
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  /**
   * Handles drag leave event for the drop zone
   */
  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  /**
   * Handles drag over event for the drop zone
   */
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Processes the selected file, validates it, and sets up preview if applicable
   * @param file - The file to process
   */
  const processFile = (file: File) => {
    // Reset states
    setError(null);
    setUploadProgress(0);
    setChunkProgress([]);
    setIsUploading(false);

    // Validate file
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Create preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  /**
   * Handles file drop event
   */
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  }, []);

  /**
   * Handles file selection via input element
   */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, []);

  /**
   * Handles the file upload process with progress tracking
   */
  const uploadFile = useCallback(async () => {
    if (!previewUrl) return;

    try {
      setIsUploading(true);
      setError(null);

      // Create a file object from the preview URL
      const response = await fetch(previewUrl);
      const blob = await response.blob();
      const file = new File([blob], 'uploaded-file', { type: blob.type });

      // Upload the file with progress tracking
      const uploadedFile = await fileService.uploadFile(file, (progress: number) => {
        setUploadProgress(progress);
      });

      // Notify parent component of successful upload
      onUploadComplete(uploadedFile);

      // Reset states after successful upload
      setPreviewUrl(null);
      setUploadProgress(0);
      setChunkProgress([]);
    } catch (err) {
      // Handle different types of errors
      if (err instanceof Error) {
        if (err.message.includes('network')) {
          setError('Network error. Please check your connection.');
        } else if (err.message.includes('timeout')) {
          setError('Upload timed out. Please try again.');
        } else {
          setError('Upload failed. Please try again.');
        }
      } else {
        setError('An unexpected error occurred.');
      }
    } finally {
      setIsUploading(false);
    }
  }, [previewUrl, onUploadComplete]);

  // Render the component
  return (
    <div className="file-upload-container">
      {/* Drop zone for file upload */}
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="file-input"
          onChange={handleFileSelect}
          accept={ALLOWED_FILE_TYPES.join(',')}
          style={{ display: 'none' }}
        />
        <label htmlFor="file-input">
          {previewUrl ? (
            // Display image preview if available
            <img src={previewUrl} alt="Preview" className="preview-image" />
          ) : (
            // Display upload instructions
            <div className="upload-instructions">
              <p>Drag and drop a file here, or click to select</p>
              <p className="file-types">Supported formats: JPG, PNG, GIF, PDF, TXT, DOC, DOCX</p>
              <p className="file-size">Max file size: 100MB</p>
            </div>
          )}
        </label>
      </div>

      {/* Upload progress display */}
      {isUploading && (
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="progress-text">
            Uploading: {uploadProgress.toFixed(1)}%
            {chunkProgress.length > 0 && (
              <span className="chunk-progress">
                (Chunks: {chunkProgress.map(p => `${p.toFixed(1)}%`).join(', ')})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error message display */}
      {error && <div className="error-message">{error}</div>}

      {/* Upload button (shown only when a file is selected) */}
      {previewUrl && !isUploading && (
        <button
          onClick={uploadFile}
          className="upload-button"
          disabled={isUploading}
        >
          Upload File
        </button>
      )}
    </div>
  );
}; 