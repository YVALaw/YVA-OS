import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = (import.meta.env.VITE_SUPABASE_URL  as string) || 'https://yfxaluoejsvodkzqgwxx.supabase.co'
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeGFsdW9lanN2b2RrenFnd3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDY0MDYsImV4cCI6MjA4OTkyMjQwNn0.YCauW1TkkMu2hBwgo9U_CZxJqWuMDALwhuquPzZnxE4'

export const supabase = createClient(supabaseUrl, supabaseAnon)
