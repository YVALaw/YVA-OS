import { supabase } from '../lib/supabase'

const BUCKET = 'attachments'

/**
 * Upload a file to Supabase Storage.
 * Returns { storageUrl, storagePath } on success, or throws.
 */
export async function uploadFile(
  file: File,
  folder: string   // e.g. 'employees/emp-uuid' or 'candidates/cand-uuid'
): Promise<{ storageUrl: string; storagePath: string }> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type })

  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  return { storageUrl: data.publicUrl, storagePath }
}

/**
 * Delete a previously uploaded file by its storage path.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath])
}
