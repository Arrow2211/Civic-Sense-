
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wnjizzmlovynxqtyfpih.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induaml6em1sb3Z5bnhxdHlmcGloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzQ5MzMsImV4cCI6MjA4NzAxMDkzM30.cmMEB0t2Z27dR5_9Gr_tK-1Ikz6mFLxaN5HtASxAtVE';

export const supabase = createClient(supabaseUrl, supabaseKey);
