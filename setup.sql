-- ==========================================================
-- CIVICSENSE: COMPLETE DATABASE INITIALIZATION
-- Run this script in your Supabase SQL Editor
-- ==========================================================

-- 1. CLEANUP (Start Fresh)
DROP TABLE IF EXISTS public.auth_sessions;
DROP TABLE IF EXISTS public.reports;
DROP TABLE IF EXISTS public.users;
DROP TYPE IF EXISTS report_status;
DROP TYPE IF EXISTS user_role;

-- 2. CREATE CUSTOM TYPES
CREATE TYPE user_role AS ENUM ('citizen', 'authority');
CREATE TYPE report_status AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- 3. CREATE USERS TABLE
-- Stores citizen profiles. Note: 'password' is used directly for this demo.
CREATE TABLE public.users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    mobile TEXT NOT NULL,
    role user_role DEFAULT 'citizen',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CREATE REPORTS TABLE
-- Main table for storing issues reported by citizens.
CREATE TABLE public.reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    citizen_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    citizen_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    timestamp BIGINT NOT NULL, -- Unix timestamp (ms) as used by the JS Date.now()
    status report_status DEFAULT 'PENDING',
    media_url TEXT NOT NULL, -- Holds Base64 data or image URLs
    media_type TEXT CHECK (media_type IN ('image', 'video')),
    ai_analysis TEXT, -- Stores insights from Gemini API
    work_done_media_url TEXT, -- Proof image of resolution
    work_done_description TEXT, -- Description of fix
    resolved_at BIGINT,
    notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CREATE AUTHORITY SESSIONS TABLE
-- Tracks active logins for authority accounts to manage the 5-member limit.
CREATE TABLE public.auth_sessions (
    username TEXT PRIMARY KEY,
    last_active TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ENABLE REALTIME
-- This allows the UI to automatically refresh when a new report is added or updated.
-- After running this, ensure 'reports' is enabled in your Supabase Dashboard -> Realtime settings.
ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;

-- 7. CONFIGURE SECURITY (Permissive for Demo)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Access Users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access Reports" ON public.reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access Sessions" ON public.auth_sessions FOR ALL USING (true) WITH CHECK (true);

-- 8. SEED DATA (Test Accounts & Initial Content)

-- Create a Test Citizen
INSERT INTO public.users (id, username, password, email, mobile, role)
VALUES ('cit_demo_001', 'JohnDoe', 'pass123', 'john@civic.com', '9876543210', 'citizen');

-- Create Sample Reports
INSERT INTO public.reports (
    citizen_id, 
    citizen_name, 
    title, 
    description, 
    category, 
    location, 
    timestamp, 
    status, 
    media_url, 
    media_type, 
    ai_analysis
) VALUES 
(
    'cit_demo_001', 
    'JohnDoe', 
    'Garbage Dumping Report', 
    'Massive pile of household waste dumped behind the primary school. Attracting stray animals.', 
    'Garbage Dumping', 
    'Back Alley, St. Jude School Area', 
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000, 
    'PENDING', 
    'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800', 
    'image', 
    'AI Observation: Significant organic and plastic waste accumulation. Severity: High. Risk: Public health hazard near school.'
),
(
    'cit_demo_001', 
    'JohnDoe', 
    'Large Pothole on Main St', 
    'Deep pothole appearing after the recent rains. Multiple cyclists have almost fallen.', 
    'Potholes/Road Damage', 
    'Corner of 4th Street and Main', 
    (EXTRACT(EPOCH FROM NOW())::BIGINT - 7200) * 1000, 
    'PENDING', 
    'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800', 
    'image', 
    'AI Observation: Asphalt erosion detected. Depth exceeds 4 inches. Severity: Medium.'
);

-- 9. PERFORMANCE INDEXES
CREATE INDEX idx_users_username ON public.users(username);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_reports_timestamp_desc ON public.reports(timestamp DESC);

-- ==========================================================
-- SQL SETUP FINISHED
-- ==========================================================