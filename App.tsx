import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, Report, ReportStatus, ReportCategory 
} from './types';
import { supabase } from './lib/supabase';

// Internal Hardcoded Authority Credentials
const AUTH_CREDENTIALS = {
  username: 'Atharv',
  password: 'Civicsense'
};

const STORAGE_KEY = 'civicsense_user_session';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [view, setView] = useState<'landing' | 'login' | 'dashboard'>('landing');
  const [role, setRole] = useState<'citizen' | 'authority'>('citizen');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);

  // Forgot Password State
  const [forgotPasswordStep, setForgotPasswordStep] = useState<'none' | 'identify' | 'otp' | 'reset'>('none');
  const [resetTargetUser, setResetTargetUser] = useState<any>(null);
  const [generatedOtp, setGeneratedOtp] = useState<string>('');
  const [enteredOtp, setEnteredOtp] = useState<string>('');

  // Session Persistence Effect
  useEffect(() => {
    const savedUser = localStorage.getItem(STORAGE_KEY);
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as User;
        setUser(parsedUser);
        setView('dashboard');
        setRole(parsedUser.role);
      } catch (e) {
        console.error("Failed to parse saved session", e);
        localStorage.removeItem(STORAGE_KEY);
        setView('landing');
      }
    } else {
      setView('landing');
    }
  }, []);

  // Analytics for Authority
  const stats = useMemo(() => {
    return {
      total: reports.length,
      pending: reports.filter(r => r.status !== ReportStatus.RESOLVED).length,
      resolved: reports.filter(r => r.status === ReportStatus.RESOLVED).length,
      byCategory: reports.reduce((acc, r) => {
        acc[r.category] = (acc[r.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
  }, [reports]);

  // Initial Fetch & Subscription
  useEffect(() => {
    const fetchReports = async () => {
      try {
        const { data, error } = await supabase
          .from('reports')
          .select('*')
          .order('timestamp', { ascending: false });
        
        if (!error && data) {
          setReports(data as Report[]);
        }
      } catch (err) {
        console.error("Supabase fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReports();

    const channels = supabase.channel('realtime-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setReports(prev => [payload.new as Report, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setReports(prev => prev.map(r => r.id === payload.new.id ? payload.new as Report : r));
          } else if (payload.eventType === 'DELETE') {
            setReports(prev => prev.filter(r => r.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      channels.unsubscribe();
    };
  }, []);

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const email = formData.get('email') as string || '';
    const mobile = formData.get('mobile') as string || '';

    if (role === 'authority') {
      if (username !== AUTH_CREDENTIALS.username || password !== AUTH_CREDENTIALS.password) {
        alert("Invalid Authority Credentials.");
        return;
      }

      // Check for max 5 members
      const { data: sessions, error: sessionError } = await supabase
        .from('auth_sessions')
        .select('*');

      if (sessionError) {
        alert("Database connection error: " + sessionError.message);
        return;
      }

      const existingSession = sessions.find(s => s.username === username);
      if (sessions.length >= 5 && !existingSession) {
        alert("Maximum 5 concurrent authority sessions are active.");
        return;
      }

      await supabase.from('auth_sessions').upsert({ 
        username, 
        last_active: new Date().toISOString() 
      });

      const newUser: User = {
        id: `auth_${username}`,
        username,
        email: 'authority@civicsense.gov',
        mobile: '',
        role: 'authority'
      };
      setUser(newUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser));
      setView('dashboard');
      return;
    }

    // Citizen Logic
    if (isSignUp) {
      if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return;
      }

      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .or(`username.eq.${username},email.eq.${email}`)
        .single();

      if (existingUser) {
        alert("Username or Email already exists. Please sign in.");
        setIsSignUp(false);
        return;
      }

      const userId = `cit_${Math.random().toString(36).substr(2, 9)}`;
      const { error: signUpError } = await supabase.from('users').insert({
        id: userId,
        username,
        password, 
        email,
        mobile,
        role: 'citizen'
      });

      if (signUpError) {
        alert("Error signing up: " + signUpError.message);
        return;
      }

      alert("Welcome to the community! Your account is ready. Please sign in.");
      setIsSignUp(false);
    } else {
      const { data: userData, error: signInError } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

      if (signInError || !userData) {
        alert("Invalid username or password.");
        return;
      }

      const loggedUser = userData as User;
      setUser(loggedUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedUser));
      setView('dashboard');
    }
  };

  const initiateForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const identifier = new FormData(e.currentTarget).get('identifier') as string;
    
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${identifier},email.eq.${identifier}`)
      .single();

    if (error || !userData) {
      alert("We couldn't find an account with that information.");
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(otp);
    setResetTargetUser(userData);
    setForgotPasswordStep('otp');
    
    const mask = (str: string) => str.slice(0, 3) + '***' + str.slice(-2);
    alert(`A 6-digit verification code has been sent to ${mask(userData.email)}.\n(Demo Code: ${otp})`);
  };

  const verifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredOtp === generatedOtp) {
      setForgotPasswordStep('reset');
    } else {
      alert("The code you entered is incorrect. Try again.");
    }
  };

  const finalizeReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newPass = formData.get('newPassword') as string;
    const confirmPass = formData.get('confirmNewPassword') as string;

    if (newPass !== confirmPass) {
      alert("Oops! The passwords don't match.");
      return;
    }

    const { error } = await supabase
      .from('users')
      .update({ password: newPass })
      .eq('id', resetTargetUser.id);

    if (error) {
      alert("Something went wrong while updating your password.");
    } else {
      alert("Success! Your password is now updated. Log in to continue.");
      setForgotPasswordStep('none');
      setResetTargetUser(null);
    }
  };

  const handleLogout = async () => {
    if (user?.role === 'authority') {
      await supabase
        .from('auth_sessions')
        .delete()
        .eq('username', user.username);
    }
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    setView('landing');
    setRole('citizen');
    setIsSignUp(false);
  };

  const submitReport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setIsUploading(true);

    const formData = new FormData(e.currentTarget);
    const file = formData.get('media') as File;
    const category = formData.get('category') as ReportCategory;
    const description = formData.get('description') as string;
    const location = formData.get('location') as string;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;

      const newReportData = {
        citizen_id: user.id,
        citizen_name: user.username,
        title: `${category} Report`,
        description,
        category,
        location,
        timestamp: Date.now(),
        status: ReportStatus.PENDING,
        media_url: base64,
        media_type: file.type.startsWith('video') ? 'video' : 'image',
        notified: false
      };

      const { error } = await supabase
        .from('reports')
        .insert([newReportData]);

      if (error) {
        alert("Failed to share report: " + error.message);
      } else {
        (e.target as HTMLFormElement).reset();
        alert("Wonderful! Your report has been shared with the community.");
      }
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleResolve = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resolvingId) return;
    setIsUploading(true);

    const formData = new FormData(e.currentTarget);
    const resolutionDesc = formData.get('resolution') as string;
    const mediaFile = formData.get('work_media') as File;

    const report = reports.find(r => r.id === resolvingId);
    if (!report) return;

    let workDoneMediaUrl = '';
    if (mediaFile && mediaFile.size > 0) {
      const reader = new FileReader();
      const promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(mediaFile);
      });
      workDoneMediaUrl = await promise;
    }

    const { error } = await supabase
      .from('reports')
      .update({
        status: ReportStatus.RESOLVED,
        work_done_description: resolutionDesc,
        work_done_media_url: workDoneMediaUrl,
        resolved_at: Date.now()
      })
      .eq('id', resolvingId);

    if (error) {
      alert("Error resolving case: " + error.message);
    } else {
      setResolvingId(null);
    }
    setIsUploading(false);
  };

  const viewingReport = useMemo(() => 
    reports.find(r => r.id === viewingReportId), 
    [viewingReportId, reports]
  );

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-white selection:bg-indigo-100">
        {/* Navigation */}
        <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-500 rounded-xl flex items-center justify-center text-white shadow-lg">
                <i className="fas fa-city text-lg"></i>
              </div>
              <span className="font-black text-xl text-slate-900 tracking-tight">CivicSense</span>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => { setRole('authority'); setView('login'); }}
                className="hidden md:block text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors"
              >
                Authority Login
              </button>
              <button 
                onClick={() => { setRole('citizen'); setView('login'); setIsSignUp(false); }}
                className="px-6 py-2.5 rounded-xl bg-slate-100 text-slate-900 font-bold text-sm hover:bg-slate-200 transition-all"
              >
                Sign In
              </button>
              <button 
                onClick={() => { setRole('citizen'); setView('login'); setIsSignUp(true); }}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all"
              >
                Join Community
              </button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-40 pb-20 px-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <motion.div 
              animate={{ 
                y: [0, -20, 0],
                rotate: [0, 5, 0]
              }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-40 left-[10%] w-64 h-64 bg-indigo-100/50 rounded-full blur-3xl"
            />
            <motion.div 
              animate={{ 
                y: [0, 20, 0],
                rotate: [0, -5, 0]
              }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="absolute bottom-20 right-[10%] w-96 h-96 bg-purple-100/50 rounded-full blur-3xl"
            />
          </div>
          <div className="max-w-7xl mx-auto text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 text-indigo-600 text-xs font-black uppercase tracking-widest mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              Empowering Citizens, Transforming Cities
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tight mb-8 leading-[1.1]">
              Your Voice Can <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">Fix Your City.</span>
            </h1>
            <p className="text-xl text-slate-500 max-w-2xl mx-auto mb-12 font-medium leading-relaxed">
              Report local issues like garbage dumping, water leakage, and potholes in seconds. 
              Track resolutions in real-time and build a cleaner, safer neighborhood together.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => { setRole('citizen'); setView('login'); setIsSignUp(true); }}
                className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-slate-900 text-white font-black text-lg shadow-2xl hover:bg-black hover:-translate-y-1 transition-all flex items-center justify-center gap-3"
              >
                Get Started Now <i className="fas fa-arrow-right text-sm opacity-50"></i>
              </button>
              <button 
                onClick={() => { setRole('authority'); setView('login'); }}
                className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-white text-slate-900 font-black text-lg border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Authority Portal
              </button>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  icon: 'fa-camera',
                  title: 'Snap & Report',
                  desc: 'Take a photo or video of the issue. Provide clear details to help authorities understand the situation.',
                  color: 'bg-indigo-500'
                },
                {
                  icon: 'fa-map-location-dot',
                  title: 'Real-time Tracking',
                  desc: 'Follow your report from submission to resolution. Get notified as soon as action is taken.',
                  color: 'bg-purple-500'
                },
                {
                  icon: 'fa-shield-check',
                  title: 'Verified Impact',
                  desc: 'Authorities provide visual proof of resolution, ensuring transparency and accountability.',
                  color: 'bg-emerald-500'
                }
              ].map((feature, i) => (
                <div key={i} className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
                  <div className={`w-14 h-14 ${feature.color} text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg group-hover:rotate-6 transition-transform`}>
                    <i className={`fas ${feature.icon} text-xl`}></i>
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 mb-4 tracking-tight">{feature.title}</h3>
                  <p className="text-slate-500 font-medium leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="bg-slate-900 rounded-[3rem] p-12 md:p-20 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/20 rounded-full blur-[120px] -mr-48 -mt-48"></div>
              <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-12 text-center">
                {[
                  { label: 'Reports Filed', val: stats.total },
                  { label: 'Issues Resolved', val: stats.resolved },
                  { label: 'Active Citizens', val: Array.from(new Set(reports.map(r => r.citizen_id))).length },
                  { label: 'Avg. Response', val: '24h' }
                ].map((stat, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="text-4xl md:text-5xl font-black mb-2 tracking-tighter">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={stat.val}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="inline-block"
                        >
                          {stat.val}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                    <div className="text-indigo-300 text-xs font-black uppercase tracking-widest">{stat.label}</div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Live Activity Feed */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center justify-between mb-12">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Live Activity</h2>
                <p className="text-slate-500 font-medium">Real-time updates from your community.</p>
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Live Updates</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {reports.slice(0, 6).map((report, i) => (
                  <motion.div
                    key={report.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -20 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 hover:bg-white hover:shadow-xl transition-all group"
                  >
                    <div className="flex items-center gap-4 mb-4 relative">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-200">
                        <img src={report.media_url} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{report.category}</p>
                          {Date.now() - report.timestamp < 120000 && (
                            <motion.span 
                              initial={{ opacity: 0, scale: 0.5 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full animate-pulse"
                            >
                              NEW
                            </motion.span>
                          )}
                        </div>
                        <h4 className="font-bold text-slate-900 line-clamp-1">{report.title}</h4>
                      </div>
                    </div>
                    <p className="text-sm text-slate-500 font-medium line-clamp-2 mb-4 italic">"{report.description}"</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                        <i className="fas fa-map-marker-alt text-rose-400"></i> {report.location}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        report.status === ReportStatus.RESOLVED ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {report.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
                <i className="fas fa-city text-xs"></i>
              </div>
              <span className="font-black text-lg text-slate-900 tracking-tight">CivicSense</span>
            </div>
            <p className="text-slate-400 text-sm font-medium">© 2026 CivicSense. Building better cities together.</p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors"><i className="fab fa-twitter"></i></a>
              <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors"><i className="fab fa-github"></i></a>
              <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors"><i className="fab fa-linkedin"></i></a>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-indigo-900 via-slate-900 to-purple-900 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-20 left-20 w-96 h-96 bg-indigo-500 rounded-full blur-[100px] animate-pulse"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-500 rounded-full blur-[100px] animate-pulse delay-700"></div>
        </div>
        
        <div className="bg-white/95 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-white/20 z-10 transition-all duration-500 hover:shadow-indigo-500/20">
          {forgotPasswordStep === 'none' ? (
            <>
              <div className="flex justify-between items-center mb-10">
                <button 
                  type="button"
                  onClick={() => setView('landing')}
                  className="text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
                >
                  <i className="fas fa-arrow-left text-[10px]"></i> Home
                </button>
                <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Secure Access</div>
              </div>

              <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-tr from-indigo-600 to-purple-500 rounded-3xl text-white mb-6 shadow-xl transform hover:scale-110 transition-transform duration-300">
                  <i className="fas fa-city text-3xl"></i>
                </div>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-2">CivicSense</h1>
                <p className="text-slate-500 text-sm font-medium">Build a better city, together.</p>
              </div>

              <div className="flex bg-slate-100/50 p-1.5 rounded-2xl mb-8 border border-slate-200/50">
                <button 
                  onClick={() => { setRole('citizen'); setIsSignUp(false); }}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${role === 'citizen' ? 'bg-white text-indigo-600 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <i className="fas fa-user-circle mr-2"></i> Citizen
                </button>
                <button 
                  onClick={() => { setRole('authority'); setIsSignUp(false); }}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${role === 'authority' ? 'bg-white text-indigo-600 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <i className="fas fa-shield-halved mr-2"></i> Authority
                </button>
              </div>

              <form onSubmit={handleAuth} className="space-y-5">
                <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                  {role === 'authority' ? 'Officer Access' : (isSignUp ? 'Create Impact' : 'Welcome Back')}
                </h2>

                <div className="space-y-4">
                  <div>
                    <input 
                      name="username" required
                      className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none font-medium placeholder:text-slate-300" 
                      placeholder="Username" 
                    />
                  </div>

                  <div>
                    <input 
                      name="password" type="password" required
                      className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none font-medium placeholder:text-slate-300" 
                      placeholder="Password" 
                    />
                  </div>

                  {role === 'citizen' && isSignUp && (
                    <>
                      <input 
                        name="confirmPassword" type="password" required
                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none font-medium placeholder:text-slate-300" 
                        placeholder="Confirm Password" 
                      />
                      <input 
                        name="email" type="email" required
                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none font-medium placeholder:text-slate-300" 
                        placeholder="Email Address" 
                      />
                      <input 
                        name="mobile" type="tel" required
                        className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none font-medium placeholder:text-slate-300" 
                        placeholder="Mobile Number" 
                      />
                    </>
                  )}
                </div>

                {!isSignUp && role === 'citizen' && (
                  <div className="flex justify-end pr-1">
                    <button 
                      type="button" 
                      onClick={() => setForgotPasswordStep('identify')}
                      className="text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      Need help signing in?
                    </button>
                  </div>
                )}

                <button 
                  type="submit"
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-200 transition-all active:scale-[0.98] mt-2 flex items-center justify-center gap-3"
                >
                  {role === 'authority' || !isSignUp ? 'Get Started' : 'Join Community'} 
                  <i className="fas fa-chevron-right text-sm opacity-50"></i>
                </button>

                {role === 'citizen' && (
                  <div className="text-center mt-6">
                    <button 
                      type="button"
                      onClick={() => setIsSignUp(!isSignUp)}
                      className="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors"
                    >
                      {isSignUp ? 'Already a hero? Sign In' : "New here? Create an account"}
                    </button>
                  </div>
                )}
              </form>
            </>
          ) : (
            <div className="space-y-8 py-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <i className="fas fa-lock-open text-2xl"></i>
                </div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Recovery</h2>
                <p className="text-slate-400 text-sm mt-2 font-medium">
                  {forgotPasswordStep === 'identify' && "Find your citizen profile."}
                  {forgotPasswordStep === 'otp' && "Check your messages for the code."}
                  {forgotPasswordStep === 'reset' && "Create a strong new password."}
                </p>
              </div>

              {forgotPasswordStep === 'identify' && (
                <form onSubmit={initiateForgotPassword} className="space-y-4">
                  <input name="identifier" required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-500/10 font-medium" placeholder="Username or Email" />
                  <button type="submit" className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-black transition-all">Verify Account</button>
                </form>
              )}

              {forgotPasswordStep === 'otp' && (
                <form onSubmit={verifyOtp} className="space-y-4">
                  <input 
                    maxLength={6}
                    value={enteredOtp}
                    onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full tracking-[1.5rem] text-center text-3xl font-black px-5 py-5 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-500/10" 
                    placeholder="000000" 
                  />
                  <button type="submit" className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg">Check Code</button>
                </form>
              )}

              {forgotPasswordStep === 'reset' && (
                <form onSubmit={finalizeReset} className="space-y-4">
                  <input name="newPassword" type="password" required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 font-medium" placeholder="New Password" />
                  <input name="confirmNewPassword" type="password" required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 font-medium" placeholder="Repeat Password" />
                  <button type="submit" className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-emerald-700">Update Password</button>
                </form>
              )}

              <button 
                onClick={() => { setForgotPasswordStep('none'); setEnteredOtp(''); }}
                className="w-full text-slate-400 hover:text-slate-600 text-sm font-bold transition-colors"
              >
                Go Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col selection:bg-indigo-100">
      {/* Dynamic Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/50 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 group">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-500 rounded-2xl flex items-center justify-center text-white shadow-lg transform group-hover:rotate-6 transition-all duration-300">
              <i className="fas fa-city text-xl"></i>
            </div>
            <div>
              <h2 className="font-black text-xl text-slate-900 tracking-tight leading-none">CivicSense</h2>
              <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{user?.role} portal</span>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden md:block text-right">
              <p className="text-sm font-black text-slate-900 capitalize">Hi, {user?.username}!</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Community Member</p>
            </div>
            <button 
              onClick={handleLogout}
              className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all duration-300 border border-rose-100 flex items-center justify-center shadow-sm"
              title="Sign Out"
            >
              <i className="fas fa-power-off text-sm"></i>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-8">
        {user?.role === 'citizen' ? (
          <>
            {/* Hero Section */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20 group-hover:bg-white/20 transition-all duration-700"></div>
              <div className="relative z-10 max-w-2xl">
                <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Spot an issue? <br/>Change the city.</h1>
                <p className="text-indigo-50 text-lg font-medium opacity-90 mb-8">Reporting local issues helps authorities act faster. Every report you file makes your neighborhood cleaner and safer.</p>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20 text-sm font-bold">
                    <i className="fas fa-check-circle text-emerald-400"></i> Easy Uploads
                  </div>
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20 text-sm font-bold">
                    <i className="fas fa-bolt text-amber-400"></i> Fast Response
                  </div>
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20 text-sm font-bold">
                    <i className="fas fa-users text-indigo-300"></i> Community Driven
                  </div>
                </div>
              </div>
              <div className="absolute right-12 bottom-0 hidden lg:block opacity-20 transform translate-y-12 group-hover:translate-y-8 transition-transform duration-700">
                <i className="fas fa-city text-[200px]"></i>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Report Launchpad */}
              <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-28">
                <section className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 transition-all hover:shadow-2xl hover:shadow-indigo-500/5">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="font-black text-2xl text-slate-900 tracking-tight flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                        <i className="fas fa-bullhorn"></i>
                      </div>
                      Share a Concern
                    </h3>
                  </div>
                  
                  <form onSubmit={submitReport} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Type of Issue</label>
                      <div className="relative">
                        <select name="category" required className="w-full p-4 rounded-2xl border border-slate-100 bg-slate-50 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all appearance-none font-bold text-slate-700">
                          {Object.values(ReportCategory).map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                          <i className="fas fa-chevron-down text-sm"></i>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Details</label>
                      <textarea 
                        name="description" required rows={3}
                        placeholder="What's happening? Be as specific as possible..."
                        className="w-full p-4 rounded-2xl border border-slate-100 bg-slate-50 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all font-medium placeholder:text-slate-300 resize-none"
                      ></textarea>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Location</label>
                      <div className="relative group">
                        <input 
                          name="location" required 
                          placeholder="Street name, landmark..." 
                          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-100 bg-slate-50 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all font-bold text-slate-700" 
                        />
                        <i className="fas fa-map-marker-alt absolute left-5 top-1/2 -translate-y-1/2 text-rose-500 transition-transform group-focus-within:scale-125"></i>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Evidence (Photo/Video)</label>
                      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-[2rem] cursor-pointer bg-slate-50/50 hover:bg-white hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/5 transition-all group">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <i className="fas fa-cloud-upload-alt text-2xl text-slate-300 group-hover:text-indigo-500 mb-2 transition-all"></i>
                          <p className="text-sm text-slate-400 font-bold group-hover:text-indigo-600">Select Media</p>
                        </div>
                        <input name="media" type="file" accept="image/*,video/*" required className="hidden" />
                      </label>
                    </div>

                    <button 
                      disabled={isUploading}
                      className="w-full bg-slate-900 hover:bg-black text-white font-black py-5 rounded-[2rem] shadow-xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95"
                    >
                      {isUploading ? (
                        <><i className="fas fa-circle-notch animate-spin"></i> Launching...</>
                      ) : (
                        <><i className="fas fa-rocket text-indigo-400"></i> Launch Report</>
                      )}
                    </button>
                  </form>
                </section>
              </div>

              {/* Activity Stream */}
              <div className="lg:col-span-7 space-y-6">
                <div className="flex items-center justify-between mb-2 px-2">
                  <h3 className="font-black text-2xl text-slate-900 tracking-tight">Community Feed</h3>
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Updates</span>
                  </div>
                </div>
                
                {reports.length === 0 && !isLoading && (
                  <div className="bg-white p-12 rounded-[2.5rem] border border-slate-100 text-center shadow-sm">
                    <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                      <i className="fas fa-leaf text-3xl text-slate-200"></i>
                    </div>
                    <p className="text-slate-400 font-bold italic text-lg">Your city is currently looking pristine!</p>
                  </div>
                )}

                {reports.map(report => (
                  <div key={report.id} className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-lg shadow-slate-200/50 flex flex-col hover:shadow-xl hover:shadow-indigo-500/5 transition-all group border-b-4 border-b-transparent hover:border-b-indigo-500">
                    <div className="flex flex-col md:flex-row">
                      <div className="md:w-56 h-56 bg-slate-100 flex-shrink-0 relative overflow-hidden">
                        {report.media_type === 'video' ? (
                          <video src={report.media_url} controls className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <img src={report.media_url} alt="Original Evidence" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        )}
                        <div className="absolute top-4 left-4">
                          <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] shadow-lg backdrop-blur-md ${
                            report.status === ReportStatus.RESOLVED ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'
                          }`}>
                            {report.status}
                          </span>
                        </div>
                      </div>
                      <div className="p-8 flex-1">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Reported by {report.citizen_name}</p>
                            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">{report.category}</p>
                            <h4 className="font-black text-xl text-slate-900 leading-tight mb-2">{report.title}</h4>
                          </div>
                          <span className="text-[11px] text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full">
                            {new Date(report.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-slate-500 text-sm font-bold mb-4 bg-slate-50 w-fit px-4 py-2 rounded-2xl">
                          <i className="fas fa-map-marker-alt text-rose-500"></i> {report.location}
                        </div>
                        
                        <p className="text-slate-600 font-medium leading-relaxed italic">"{report.description}"</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* Authority Dashboard - Command Center */
          <div className="lg:col-span-12 space-y-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Command Center</h1>
                <p className="text-slate-500 font-medium">Real-time citizen engagement and impact monitoring.</p>
              </div>
              <div className="flex items-center gap-3 bg-white p-2 rounded-[2rem] shadow-lg border border-slate-100">
                <div className="px-6 py-2 bg-slate-900 rounded-full text-white text-xs font-black uppercase tracking-widest">Reports: {stats.total}</div>
                <div className="px-6 py-2 bg-emerald-50 text-emerald-600 rounded-full text-xs font-black uppercase tracking-widest">Fixed: {stats.resolved}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Pending Action', val: stats.pending, color: 'from-amber-500 to-orange-500', icon: 'fa-hourglass-half' },
                { label: 'Active Reports', val: stats.total, color: 'from-indigo-500 to-blue-500', icon: 'fa-chart-line' },
                { label: 'Total Resolved', val: stats.resolved, color: 'from-emerald-500 to-teal-500', icon: 'fa-check-circle' },
                { label: 'Categories', val: Object.keys(stats.byCategory).length, color: 'from-purple-500 to-pink-500', icon: 'fa-tags' },
              ].map((stat, i) => (
                <div key={i} className={`p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-xl shadow-slate-200/50 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden group`}>
                   <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${stat.color} opacity-0 group-hover:opacity-10 rounded-full -mr-8 -mt-8 transition-opacity duration-500`}></div>
                   <div className="relative z-10 flex items-center justify-between">
                     <div>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                       <span className="text-4xl font-black text-slate-900 tracking-tighter">{stat.val}</span>
                     </div>
                     <div className={`w-14 h-14 bg-gradient-to-br ${stat.color} text-white rounded-2xl flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform duration-500`}>
                       <i className={`fas ${stat.icon} text-xl`}></i>
                     </div>
                   </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-[3rem] border border-slate-100 shadow-2xl overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-black text-2xl text-slate-900 tracking-tight">Active Queue</h3>
                <div className="flex gap-2">
                   <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                   <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse delay-200"></div>
                   <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse delay-500"></div>
                </div>
              </div>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-left border-separate border-spacing-y-4">
                  <thead>
                    <tr className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
                      <th className="px-6 py-4">Evidence</th>
                      <th className="px-6 py-4">Report Details</th>
                      <th className="px-6 py-4">Location</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(report => (
                      <tr key={report.id} className="bg-white hover:bg-slate-50 transition-all rounded-[2rem] group">
                        <td className="px-6 py-4 first:rounded-l-[2rem]">
                          <div className="relative w-16 h-16 rounded-2xl overflow-hidden shadow-md group-hover:scale-105 transition-transform duration-300">
                            <img src={report.media_url} className="w-full h-full object-cover" />
                            {report.media_type === 'video' && <i className="fas fa-play absolute inset-0 m-auto text-white text-xs bg-black/40 w-fit h-fit p-1.5 rounded-full"></i>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-black text-slate-900 mb-0.5">{report.title}</p>
                          <p className="text-[10px] font-bold text-indigo-500 uppercase">{report.citizen_name}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                            <i className="fas fa-map-pin text-rose-500"></i>
                            {report.location}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest ${
                            report.status === ReportStatus.RESOLVED ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                          }`}>
                            {report.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 last:rounded-r-[2rem] text-center">
                          <div className="flex items-center justify-center gap-4">
                            <button 
                              onClick={() => setViewingReportId(report.id)}
                              className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all duration-300 flex items-center justify-center shadow-sm"
                            >
                              <i className="fas fa-expand-alt text-sm"></i>
                            </button>
                            {report.status !== ReportStatus.RESOLVED && (
                              <button 
                                onClick={() => setResolvingId(report.id)}
                                className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all duration-300 flex items-center justify-center shadow-sm border border-emerald-100"
                              >
                                <i className="fas fa-check text-sm"></i>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modern Detailed Modal */}
      {viewingReportId && viewingReport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col transform animate-in zoom-in-95 duration-500">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center text-2xl shadow-inner">
                  <i className="fas fa-file-alt"></i>
                </div>
                <div>
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Full Case View</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Reference: {viewingReport.id.slice(0, 8)}</p>
                </div>
              </div>
              <button 
                onClick={() => setViewingReportId(null)}
                className="w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-200"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="overflow-y-auto p-8 md:p-12">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-6">
                  <div className="rounded-[2.5rem] overflow-hidden border border-slate-100 shadow-2xl bg-slate-100 group">
                    {viewingReport.media_type === 'video' ? (
                      <video src={viewingReport.media_url} controls className="w-full h-auto aspect-square object-cover" />
                    ) : (
                      <img src={viewingReport.media_url} alt="Evidence" className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-1000" />
                    )}
                  </div>
                  <div className="flex gap-4 p-6 bg-slate-50 rounded-[2rem] border border-slate-100 items-center">
                    <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-indigo-500 font-black text-xl">
                      <i className="fas fa-fingerprint"></i>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Metadata</p>
                      <p className="text-xs font-bold text-slate-600">Captured on {new Date(viewingReport.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-indigo-100">{viewingReport.category}</span>
                      <span className={`text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg ${
                        viewingReport.status === ReportStatus.RESOLVED ? 'bg-emerald-500 text-white shadow-emerald-100' : 'bg-amber-500 text-white shadow-amber-100'
                      }`}>
                        {viewingReport.status}
                      </span>
                    </div>
                    <h4 className="text-5xl font-black text-slate-900 leading-[0.9] tracking-tighter">{viewingReport.title}</h4>
                    <p className="text-2xl text-slate-400 font-black flex items-center gap-3 tracking-tight">
                      <i className="fas fa-location-arrow text-rose-500"></i> {viewingReport.location}
                    </p>
                  </div>

                  <div className="p-8 bg-slate-900 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <i className="fas fa-quote-right text-6xl"></i>
                    </div>
                    <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4">Citizen Statement</h5>
                    <p className="text-xl leading-relaxed font-bold italic opacity-90">
                      "{viewingReport.description}"
                    </p>
                    <p className="mt-4 text-xs font-black text-indigo-400">— Submitted by {viewingReport.citizen_name}</p>
                  </div>

                  {viewingReport.status === ReportStatus.RESOLVED && (
                    <div className="p-8 bg-emerald-600 rounded-[2.5rem] text-white shadow-xl shadow-emerald-200">
                      <h5 className="text-[10px] font-black text-emerald-200 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <i className="fas fa-medal"></i> Success Outcome
                      </h5>
                      <div className="flex gap-6">
                        {viewingReport.work_done_media_url && (
                          <img src={viewingReport.work_done_media_url} className="w-28 h-28 rounded-3xl object-cover border-4 border-white/20 shadow-lg" />
                        )}
                        <div>
                          <p className="font-black text-xl mb-2 tracking-tight">Resolution Complete</p>
                          <p className="text-emerald-50 text-sm font-bold opacity-90 leading-relaxed">"{viewingReport.work_done_description}"</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-slate-100 bg-white flex items-center justify-between">
              <button 
                onClick={() => setViewingReportId(null)}
                className="px-8 py-4 text-sm font-black text-slate-400 hover:text-slate-900 transition-colors"
              >
                Go Back
              </button>
              {viewingReport.status !== ReportStatus.RESOLVED && role === 'authority' && (
                <button 
                  onClick={() => { setViewingReportId(null); setResolvingId(viewingReport.id); }}
                  className="bg-indigo-600 text-white font-black py-5 px-12 rounded-[2rem] shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3"
                >
                  <i className="fas fa-tools"></i> Take Action
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modern Action Modal */}
      {resolvingId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md transition-all">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 transform animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">Finish Task</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Job Reference: #{resolvingId.slice(0, 6)}</p>
              </div>
              <button onClick={() => setResolvingId(null)} className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center shadow-sm">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <form onSubmit={handleResolve} className="p-8 space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Resolution Summary</label>
                <textarea 
                  name="resolution" required rows={4} 
                  className="w-full p-5 rounded-[2rem] bg-slate-50 border border-slate-100 focus:ring-4 focus:ring-emerald-500/10 focus:bg-white outline-none transition-all font-bold text-slate-700 placeholder:text-slate-300 resize-none" 
                  placeholder="Describe the amazing work your team did..."
                ></textarea>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Work Proof (Image)</label>
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-emerald-200 rounded-[1.5rem] cursor-pointer bg-emerald-50/20 hover:bg-emerald-50 transition-all group">
                  <div className="flex items-center gap-3">
                    <i className="fas fa-camera text-emerald-400 text-xl"></i>
                    <p className="text-xs font-black text-emerald-700">Attach Evidence</p>
                  </div>
                  <input name="work_media" type="file" accept="image/*" required className="hidden" />
                </label>
              </div>
              <button 
                disabled={isUploading} 
                className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black shadow-2xl shadow-emerald-200 hover:bg-emerald-700 hover:scale-[1.02] transition-all disabled:opacity-50 active:scale-95 flex items-center justify-center gap-3"
              >
                {isUploading ? (
                  <span className="flex items-center gap-2"><i className="fas fa-circle-notch animate-spin"></i> Processing...</span>
                ) : (
                  <span className="flex items-center gap-2"><i className="fas fa-check-circle"></i> Complete Task</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
