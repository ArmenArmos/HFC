'use client'

import { useState, useCallback } from 'react'
import { useWizard } from './wizard-context'
import { Button } from '@/components/ui/button'

interface UploadedFile {
  name: string
  size: number
  type: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/dicom',
  'application/zip',
  'application/x-zip-compressed',
]

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export function Step3FileUpload() {
  const { next, prev } = useWizard()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [dragOver, setDragOver] = useState(false)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const newFiles: UploadedFile[] = Array.from(incoming).map((f) => {
      if (f.size > MAX_FILE_SIZE) {
        return { name: f.name, size: f.size, type: f.type, status: 'error', error: 'File exceeds 50 MB limit' }
      }
      // Accept all — mime check is advisory; server does real validation
      return { name: f.name, size: f.size, type: f.type, status: 'pending' }
    })
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index))

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Medical Documents</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload relevant files: lab reports, imaging (DICOM), prescriptions, referral letters, or
          prior reports. Accepted: PDF, JPEG, PNG, DICOM, ZIP. Max 50 MB per file.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        }`}
      >
        <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="mb-1 text-sm font-medium text-gray-700">Drag & drop files here</p>
        <p className="mb-4 text-xs text-gray-500">or click to browse</p>
        <label className="cursor-pointer rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-600 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Browse Files
          <input
            type="file"
            className="sr-only"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.dcm,.zip"
            onChange={onInputChange}
          />
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="divide-y rounded-lg border bg-white">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-lg">{f.type.includes('pdf') ? '📄' : f.type.includes('image') ? '🖼️' : '📁'}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{f.name}</p>
                  <p className="text-xs text-gray-400">{formatSize(f.size)}</p>
                  {f.error && <p className="text-xs text-red-500">{f.error}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {f.status === 'done' && <span className="text-xs text-green-600">✓ Ready</span>}
                {f.status === 'pending' && <span className="text-xs text-gray-400">Pending upload</span>}
                {f.status === 'error' && <span className="text-xs text-red-500">Error</span>}
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 text-gray-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400">
        Files are encrypted in transit and at rest. A virus scan will run automatically after upload.
      </p>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prev}>← Back</Button>
        <Button onClick={next}>
          {files.filter((f) => f.status !== 'error').length > 0
            ? `Continue with ${files.filter((f) => f.status !== 'error').length} file(s) →`
            : 'Skip & Continue →'}
        </Button>
      </div>
    </div>
  )
}
