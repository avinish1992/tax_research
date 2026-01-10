'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, FileText, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface UploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFilesSelected: (files: File[]) => void
  isUploading?: boolean
}

const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/html': ['.html'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export function UploadModal({
  open,
  onOpenChange,
  onFilesSelected,
  isUploading = false,
}: UploadModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setError(null)

    if (rejectedFiles.length > 0) {
      const errors = rejectedFiles.map(f => {
        const error = f.errors[0]
        if (error.code === 'file-too-large') {
          return `${f.file.name} is too large (max 50MB)`
        }
        if (error.code === 'file-invalid-type') {
          return `${f.file.name} is not a supported file type`
        }
        return `${f.file.name}: ${error.message}`
      })
      setError(errors.join(', '))
    }

    if (acceptedFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...acceptedFiles])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  })

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUpload = () => {
    if (selectedFiles.length === 0) return
    onFilesSelected(selectedFiles)
    // Clear after upload starts - modal will close when parent sets open=false
    setSelectedFiles([])
    setError(null)
  }

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFiles([])
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
        </DialogHeader>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={cn(
            "mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-secondary/50"
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center",
              isDragActive ? "bg-primary/10" : "bg-secondary"
            )}>
              <Upload className={cn(
                "w-6 h-6",
                isDragActive ? "text-primary" : "text-muted-foreground"
              )} />
            </div>
            <div>
              <p className="text-sm font-medium">
                {isDragActive ? "Drop files here" : "Drag & drop files, or click to select"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, DOCX, TXT, MD, HTML, PPTX, XLSX (max 50MB)
              </p>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Selected files ({selectedFiles.length})</p>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 p-2 bg-secondary/50 rounded-lg"
                >
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(index)
                    }}
                    className="p-1 hover:bg-secondary rounded"
                    disabled={isUploading}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || isUploading}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
