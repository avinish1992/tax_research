import { createClient } from '@/utils/supabase/server'

const BUCKET_NAME = 'documents'

export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  userId: string
): Promise<string> {
  const supabase = await createClient()

  // Store files in user-specific folders for RLS
  const storagePath = `${userId}/${Date.now()}-${fileName}`

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (error) {
    console.error('Supabase storage upload error:', error)
    throw new Error(`Failed to upload file: ${error.message}`)
  }

  return data.path
}

export async function downloadFile(storagePath: string): Promise<string> {
  const supabase = await createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 86400) // 24 hour expiry

  if (error) {
    console.error('Supabase storage download error:', error)
    throw new Error(`Failed to create download URL: ${error.message}`)
  }

  return data.signedUrl
}

export async function deleteFile(storagePath: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([storagePath])

  if (error) {
    console.error('Supabase storage delete error:', error)
    throw new Error(`Failed to delete file: ${error.message}`)
  }
}

export async function getPublicUrl(storagePath: string): Promise<string> {
  const supabase = await createClient()

  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath)

  return data.publicUrl
}
