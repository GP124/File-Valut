import axios from 'axios';
import { File as FileType, UploadProgress } from '../types/file';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_RETRIES = 3;

// Create axios instance with default config
const api = axios.create({
  baseURL: API_URL,
  timeout: 30000, // 30 seconds timeout
});

export const fileService = {
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void,
    onChunkProgress?: (chunkProgress: number) => void
  ): Promise<FileType> {
    const formData = new FormData();
    formData.append('file', file);

    // For small files, use regular upload
    if (file.size <= CHUNK_SIZE) {
      const response = await api.post('/files/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(progress);
          }
        },
      });
      return response.data;
    }

    // For large files, use chunked upload
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileId = crypto.randomUUID();
    let uploadedChunks = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      
      const chunkFormData = new FormData();
      chunkFormData.append('file', chunk);
      chunkFormData.append('fileId', fileId);
      chunkFormData.append('chunkIndex', chunkIndex.toString());
      chunkFormData.append('totalChunks', totalChunks.toString());
      chunkFormData.append('originalFilename', file.name);

      let retries = 0;
      let success = false;

      while (retries < MAX_RETRIES && !success) {
        try {
          await api.post('/files/chunk/', chunkFormData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
              if (onChunkProgress && progressEvent.total) {
                const chunkProgress = Math.round(
                  (progressEvent.loaded * 100) / progressEvent.total
                );
                onChunkProgress(chunkProgress);
              }
            },
          });
          success = true;
          uploadedChunks++;
          
          if (onProgress) {
            const overallProgress = Math.round((uploadedChunks / totalChunks) * 100);
            onProgress(overallProgress);
          }
        } catch (error) {
          retries++;
          if (retries === MAX_RETRIES) {
            throw new Error(`Failed to upload chunk ${chunkIndex} after ${MAX_RETRIES} retries`);
          }
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
        }
      }
    }

    // Complete the upload
    const response = await api.post('/files/complete/', {
      fileId,
      originalFilename: file.name,
      totalChunks,
    });

    return response.data;
  },

  async getFiles(): Promise<FileType[]> {
    const response = await api.get('/files/');
    return response.data;
  },

  async deleteFile(id: string): Promise<void> {
    await api.delete(`/files/${id}/`);
  },

  async downloadFile(fileUrl: string, filename: string): Promise<void> {
    try {
      const response = await api.get(fileUrl, {
        responseType: 'blob',
      });
      
      // Create a blob URL and trigger download
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      throw new Error('Failed to download file');
    }
  },
}; 