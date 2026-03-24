import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://yfxaluoejsvodkzqgwxx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeGFsdW9lanN2b2RrenFnd3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDY0MDYsImV4cCI6MjA4OTkyMjQwNn0.YCauW1TkkMu2hBwgo9U_CZxJqWuMDALwhuquPzZnxE4'
)
